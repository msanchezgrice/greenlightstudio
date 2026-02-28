import type { SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { emitJobEvent } from "../job-events";
import { loadMemory, writeMemory, formatMemoryForPrompt } from "../memory";
import { executeAgentQuery, type StreamEvent } from "@/lib/agent";

const CODE_GEN_PROFILE = {
  name: "code_generator",
  tools: ["Read", "Write", "Edit", "Bash", "WebSearch"],
  allowedTools: ["Read", "Write", "Edit", "Bash", "WebSearch"],
  maxTurns: 30,
  timeoutMs: 1_800_000,
  permissionMode: "dontAsk" as const,
};

export async function handleCodeGenerateMvp(
  db: SupabaseClient,
  job: { id: string; project_id: string; payload: Record<string, unknown> }
) {
  const payload = job.payload ?? {};
  const projectId = (payload.projectId as string) ?? job.project_id;
  const ownerClerkId = payload.ownerClerkId as string;
  const description = payload.description as string;
  const repoUrl = payload.repoUrl as string | undefined;
  const branch = (payload.branch as string) ?? "greenlight/mvp-v1";

  const project = await db
    .from("projects")
    .select("id,name,domain,phase,permissions,repo_url,runtime_mode")
    .eq("id", projectId)
    .single();
  if (project.error || !project.data) throw new Error("Project not found");

  const latestPacket = await db
    .from("phase_packets")
    .select("packet_json")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const memories = await loadMemory(db, projectId);
  const memoryContext = formatMemoryForPrompt(memories);

  const workDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `greenlight-mvp-${projectId.slice(0, 8)}-`)
  );

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "log",
    message: "Setting up workspace",
  });

  const targetRepo = repoUrl ?? project.data.repo_url;
  if (targetRepo) {
    const { execSync } = await import("node:child_process");
    try {
      execSync(
        `git clone --depth 1 "${targetRepo}" "${workDir}" 2>&1`,
        { timeout: 60_000, env: { ...process.env } }
      );
      execSync(`git checkout -b "${branch}"`, { cwd: workDir, timeout: 10_000 });
    } catch (e) {
      await emitJobEvent(db, {
        projectId,
        jobId: job.id,
        type: "log",
        message: `Git clone failed; starting from empty dir: ${(e as Error).message}`,
      });
    }
  }

  const packetSummary = latestPacket?.data?.packet_json
    ? JSON.stringify(latestPacket.data.packet_json).slice(0, 3000)
    : "No phase packet available";

  const prompt = [
    `You are building an MVP website/app for the project "${project.data.name}" (domain: ${project.data.domain ?? "unknown"}).`,
    `Your working directory is: ${workDir}`,
    "",
    "## Project Context",
    memoryContext,
    "",
    "## Latest Phase Packet Summary",
    packetSummary,
    "",
    "## User Request",
    description,
    "",
    "## Instructions",
    "1. Generate a complete, working website/app in the working directory.",
    "2. Use modern tech stack: Next.js/React preferred, with Tailwind CSS.",
    "3. Include a README.md with setup instructions.",
    "4. Make it production-ready: responsive, accessible, with proper meta tags.",
    "5. If the phase packet includes brand kit info (colors, fonts), use them.",
    "6. Include a waitlist/signup form if appropriate.",
    "7. All code must be self-contained and runnable with `npm install && npm run dev`.",
  ].join("\n");

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "log",
    message: "Starting code generation agent",
  });

  const hooks = {
    onStreamEvent: async (event: StreamEvent) => {
      if (event.type === "text_delta") {
        await emitJobEvent(db, {
          projectId,
          jobId: job.id,
          type: "delta",
          message: event.text,
        });
      } else if (event.type === "tool_use") {
        await emitJobEvent(db, {
          projectId,
          jobId: job.id,
          type: "tool_call",
          message: `Using ${event.tool}`,
          data: { tool: event.tool },
        });
      }
    },
  };

  await executeAgentQuery(
    projectId,
    ownerClerkId,
    prompt,
    CODE_GEN_PROFILE,
    "phase0",
    hooks
  );

  const generatedFiles: string[] = [];
  async function collectFiles(dir: string, prefix: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      const rel = path.join(prefix, entry.name);
      if (entry.isDirectory()) {
        await collectFiles(full, rel);
      } else {
        generatedFiles.push(rel);
      }
    }
  }
  await collectFiles(workDir, "");

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "log",
    message: `Generated ${generatedFiles.length} files`,
  });

  if (targetRepo && process.env.GITHUB_TOKEN) {
    try {
      const { execSync } = await import("node:child_process");
      execSync("git add -A && git commit -m 'Greenlight MVP generation'", {
        cwd: workDir,
        timeout: 30_000,
        env: { ...process.env },
      });
      execSync(`git push origin "${branch}" --force`, {
        cwd: workDir,
        timeout: 60_000,
        env: { ...process.env },
      });

      await emitJobEvent(db, {
        projectId,
        jobId: job.id,
        type: "artifact",
        message: `Code pushed to ${targetRepo} on branch ${branch}`,
        data: { repoUrl: targetRepo, branch, fileCount: generatedFiles.length },
      });
    } catch (e) {
      await emitJobEvent(db, {
        projectId,
        jobId: job.id,
        type: "log",
        message: `Git push failed: ${(e as Error).message}`,
      });
    }
  }

  const permissions = project.data.permissions as Record<string, unknown> | null;
  if (permissions?.deploy && process.env.VERCEL_DEPLOY_HOOK_URL) {
    try {
      await fetch(process.env.VERCEL_DEPLOY_HOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          action: "mvp_deploy",
          branch,
        }),
      });
      await emitJobEvent(db, {
        projectId,
        jobId: job.id,
        type: "artifact",
        message: "Vercel deploy triggered",
      });
    } catch (e) {
      await emitJobEvent(db, {
        projectId,
        jobId: job.id,
        type: "log",
        message: `Deploy trigger failed: ${(e as Error).message}`,
      });
    }
  }

  await writeMemory(db, projectId, job.id, [
    {
      category: "decision",
      key: "mvp_tech_stack",
      value: `MVP generated with ${generatedFiles.length} files`,
      agentKey: "engineering",
    },
    {
      category: "learning",
      key: "mvp_generation_completed",
      value: `MVP generated at ${new Date().toISOString()} in branch ${branch}`,
      agentKey: "engineering",
    },
  ]);

  try {
    await fs.rm(workDir, { recursive: true, force: true });
  } catch {}
}
