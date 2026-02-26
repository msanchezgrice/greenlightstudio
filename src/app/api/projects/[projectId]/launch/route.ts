import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withRetry } from "@/lib/retry";
import { createServiceSupabase } from "@/lib/supabase";
import { logPhase0Failure, runPhase0 } from "@/lib/phase0";

export const runtime = "nodejs";
export const maxDuration = 300;

async function hasRecentActiveLaunch(projectId: string) {
  const db = createServiceSupabase();
  const { data, error } = await withRetry(() =>
    db
      .from("tasks")
      .select("id")
      .eq("project_id", projectId)
      .in("description", ["phase0_init", "phase0_research", "phase0_synthesis"])
      .eq("status", "running")
      .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .limit(1),
  );
  if (error) throw new Error(error.message);
  return Boolean(data?.length);
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

    await runPhase0({
      projectId,
      userId: runAsUserId,
      revisionGuidance,
      forceNewApproval,
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
