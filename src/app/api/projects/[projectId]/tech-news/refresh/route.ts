import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { JOB_TYPES, AGENT_KEYS, PRIORITY } from "@/lib/jobs/constants";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_: Request, context: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await context.params;
  const db = createServiceSupabase();

  const { data: project, error: projectError } = await withRetry(() =>
    db
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("owner_clerk_id", userId)
      .maybeSingle(),
  );

  if (projectError) {
    return NextResponse.json({ error: projectError.message }, { status: 500 });
  }
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const bucket = Math.floor(Date.now() / 60_000);
    const jobId = await enqueueJob({
      projectId,
      jobType: JOB_TYPES.TECH_NEWS_REFRESH,
      agentKey: AGENT_KEYS.RESEARCH,
      payload: {
        projectId,
        reason: "manual",
        requestedBy: userId,
      },
      idempotencyKey: `tech-news:manual:${projectId}:${bucket}`,
      priority: PRIORITY.USER_INTERACTIVE,
    });

    return NextResponse.json({ ok: true, jobId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to queue tech-news refresh";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
