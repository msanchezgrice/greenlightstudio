import type { SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { emitJobEvent } from "../job-events";
import { loadMemory, writeMemory, formatMemoryForPrompt } from "../memory";
import { executeAgentQuery, type StreamEvent } from "@/lib/agent";
import { githubRepository, gitBranch, gitOperations } from "../git-safe";

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
  if (payload.projectId && payload.projectId !== job.project_id) throw new Error("Project does not match job");
  const projectId = job.project_id;
  const ownerClerkId = payload.ownerClerkId as string;
  const description = payload.description as string;
  const repoUrl = payload.repoUrl as string | undefined;
  const branch = gitBranch(payload.branch ?? "greenlight/mvp-v1");

  const project = await db
    .from("projects")
    .select("id,name,domain,phase,permissions,repo_url,runtime_mode,owner_clerk_id")
    .eq("id", projectId)
    .single();
  if (project.error || !project.data || !ownerClerkId || project.data.owner_clerk_id !== ownerClerkId) throw new Error("Project not found");
  // Only a server-owned project repository may be used; payload is not authority.
  const targetRepo = project.data.repo_url ? githubRepository(project.data.repo_url) : null;
  if (repoUrl && (!targetRepo || githubRepository(repoUrl) !== targetRepo)) throw new Error("Repository does not match project configuration");
  const git = gitOperations();
  const permissions = project.data.permissions as Record<string, unknown> | null;
  if (targetRepo && permissions?.repo_write === true) {
    const identityNames = ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"] as const;
    if (!process.env.GITHUB_TOKEN?.trim() || identityNames.some(name => !process.env[name]?.trim())) {
      throw new Error("Repository write is unavailable until its credential and verified Git identity are configured");
    }
  }

  let latestPacketPayload: unknown = null;
  const latestPacket = await db
    .from("phase_packets")
    .select("packet_data,packet")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestPacket.error) {
    const fallback = await db
      .from("phase_packets")
      .select("packet")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fallback.error) throw new Error(fallback.error.message);
    latestPacketPayload = fallback.data?.packet ?? null;
  } else {
    latestPacketPayload = latestPacket.data?.packet_data ?? latestPacket.data?.packet ?? null;
  }

  const memories = await loadMemory(db, projectId);
  const memoryContext = formatMemoryForPrompt(memories);

  const workDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `greenlight-mvp-${projectId.slice(0, 8)}-`)
  );

  let agentHome: string | undefined;
  try {
  agentHome = await fs.mkdtemp(path.join(os.tmpdir(), "greenlight-agent-home-"));

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "log",
    message: "Setting up workspace",
  });

  if (targetRepo) {
    try {
      await git.clone(targetRepo, workDir, process.env.GITHUB_TOKEN?.trim());
      await git.checkout(workDir, branch);
    } catch {
      await fs.rm(workDir, { recursive: true, force: true });
      throw new Error("Git setup failed");
    }
  }

  const packetSummary = latestPacketPayload
    ? JSON.stringify(latestPacketPayload).slice(0, 3000)
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

  try {
    await executeAgentQuery(
      projectId,
      ownerClerkId,
      prompt,
      CODE_GEN_PROFILE,
      "phase0",
      hooks,
      { cwd: workDir, codegenEnvironmentHome: agentHome }
    );
  } catch (agentErr) {
    try { await fs.rm(workDir, { recursive: true, force: true }); } catch {}
    throw agentErr;
  }

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

  if (targetRepo && process.env.GITHUB_TOKEN && permissions?.repo_write === true) {
    try {
      await git.push(workDir, targetRepo, branch, process.env.GITHUB_TOKEN);
      await emitJobEvent(db, {
        projectId, jobId: job.id, type: "artifact",
        message: "Code pushed to the configured repository",
        data: { repoUrl: targetRepo, branch, fileCount: generatedFiles.length },
      });
    } catch {
      await emitJobEvent(db, { projectId, jobId: job.id, type: "log", message: "Git push failed" });
      await fs.rm(workDir, { recursive: true, force: true });
      throw new Error("Git push failed");
    }
  }

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

  } finally {
    try { await fs.rm(workDir, { recursive: true, force: true }); } catch { /* best effort */ }
    if (agentHome) try { await fs.rm(agentHome, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
