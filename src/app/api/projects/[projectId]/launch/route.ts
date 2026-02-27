import { auth } from "@clerk/nextjs/server";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { withRetry } from "@/lib/retry";
import { createServiceSupabase } from "@/lib/supabase";
import { logPhase0Failure, runPhase0 } from "@/lib/phase0";

export const runtime = "nodejs";
export const maxDuration = 300;

type LaunchTaskRow = {
  description: string;
  status: string;
  created_at: string;
};

async function hasRecentActiveLaunch(projectId: string) {
  const db = createServiceSupabase();
  const { data, error } = await withRetry(() =>
    db
      .from("tasks")
      .select("description,status,created_at")
      .eq("project_id", projectId)
      .in("description", ["phase0_init", "phase0_research", "phase0_synthesis", "phase0_complete", "phase0_failed"])
      .gte("created_at", new Date(Date.now() - 20 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(120),
  );
  if (error) throw new Error(error.message);
  const tasks = (data ?? []) as LaunchTaskRow[];
  if (!tasks.length) return false;

  const ordered = tasks
    .map((task) => ({ ...task, createdAtMs: Date.parse(task.created_at) }))
    .filter((task) => Number.isFinite(task.createdAtMs))
    .sort((left, right) => left.createdAtMs - right.createdAtMs);

  const latestInit = [...ordered].reverse().find((task) => task.description === "phase0_init" && task.status === "running");
  if (!latestInit) return false;

  const threshold = latestInit.createdAtMs - 5_000;
  const currentAttemptTasks = ordered.filter((task) => task.createdAtMs >= threshold);
  const hasTerminal = currentAttemptTasks.some(
    (task) =>
      (task.description === "phase0_complete" && task.status === "completed") ||
      (task.description === "phase0_failed" && task.status === "failed"),
  );
  if (hasTerminal) return false;

  return currentAttemptTasks.some(
    (task) =>
      ["phase0_init", "phase0_research", "phase0_synthesis"].includes(task.description) &&
      task.status === "running",
  );
}

const launchRequestSchema = z.object({
  revisionGuidance: z.string().trim().max(2000).optional(),
  forceNewApproval: z.boolean().optional(),
});

async function parseLaunchBody(req: Request) {
  const raw = await req.text();
  if (!raw.trim()) return { revisionGuidance: undefined, forceNewApproval: undefined };
  const parsed = launchRequestSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid launch payload");
  }
  return parsed.data;
}

export async function POST(req: Request, context: { params: Promise<{ projectId: string }> }) {
  const authState = await auth();
  const externalUserId = authState.userId;

  const { projectId } = await context.params;
  const db = createServiceSupabase();

  try {
    const internalKey = req.headers.get("x-greenlight-internal-key");
    const internalSecret = process.env.CRON_SECRET?.trim() || null;
    const isInternalLaunch = Boolean(internalKey && internalSecret && internalKey === internalSecret);
    if (!isInternalLaunch && !externalUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const launchBody = await parseLaunchBody(req);
    const revisionGuidance = launchBody.revisionGuidance?.trim() || null;
    const forceNewApproval = Boolean(launchBody.forceNewApproval);

    const { data: project, error: projectError } = await withRetry(() =>
      db.from("projects").select("id, owner_clerk_id").eq("id", projectId).single(),
    );
    if (projectError || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (!isInternalLaunch && project.owner_clerk_id !== externalUserId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const runAsUserId = (project.owner_clerk_id as string | null) ?? externalUserId;
    if (!runAsUserId) {
      return NextResponse.json({ error: "Project owner not found" }, { status: 400 });
    }

    const launchAlreadyRunning = await hasRecentActiveLaunch(projectId);
    if (launchAlreadyRunning) {
      return NextResponse.json({ ok: true, started: false, alreadyRunning: true });
    }

    if (!forceNewApproval && !revisionGuidance) {
      const { data: existingPacket, error: packetError } = await withRetry(() =>
        db.from("phase_packets").select("id").eq("project_id", projectId).eq("phase", 0).maybeSingle(),
      );
      if (packetError) {
        return NextResponse.json({ error: packetError.message }, { status: 400 });
      }
      if (existingPacket) {
        return NextResponse.json({ ok: true, started: false, alreadyCompleted: true });
      }
    }

    after(async () => {
      try {
        await runPhase0({
          projectId,
          userId: runAsUserId,
          revisionGuidance,
          forceNewApproval,
        });
      } catch (bgError) {
        await logPhase0Failure(projectId, bgError);
      }
    });

    return NextResponse.json({ ok: true, started: true });
  } catch (error) {
    await logPhase0Failure(projectId, error);
    const errorMessage = error instanceof Error ? error.message : "Failed generating Phase 0 packet";
    const statusCode = errorMessage === "Project not found" ? 404 : 500;
    return NextResponse.json(
      { error: errorMessage },
      { status: statusCode },
    );
  }
}
