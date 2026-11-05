import { NextResponse } from "next/server";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { JOB_TYPES, AGENT_KEYS, PRIORITY, SYSTEM_PROJECT_ID } from "@/lib/jobs/constants";
import { createServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

function authorized(req: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return false;

  const authHeader = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const directSecret = req.headers.get("x-night-shift-secret")?.trim();

  return authHeader === cronSecret || directSecret === cronSecret;
}

export async function GET(req: Request) {
  return scheduleRun(req);
}

export async function POST(req: Request) {
  return scheduleRun(req);
}

async function scheduleRun(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const minute = new Date().toISOString().slice(0, 16);

  // A scheduler tick checks what is due now; an older pending tick can do the
  // same work. Preserve existing work instead of adding another minute of debt.
  const db = createServiceSupabase();
  const pending = await db.from("agent_jobs").select("id")
    .eq("project_id", SYSTEM_PROJECT_ID)
    .eq("job_type", JOB_TYPES.SCHEDULER_RUN_RECURRING)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (pending.error) {
    return NextResponse.json({ error: "Scheduler availability check failed" }, { status: 503 });
  }
  if (pending.data?.id) {
    return NextResponse.json({ ok: true, jobId: pending.data.id, minute, coalesced: true });
  }

  const jobId = await enqueueJob({
    projectId: SYSTEM_PROJECT_ID,
    jobType: JOB_TYPES.SCHEDULER_RUN_RECURRING,
    agentKey: AGENT_KEYS.SYSTEM,
    payload: {
      limit: 200,
      trigger: "cron",
      minute,
    },
    idempotencyKey: `scheduler:${minute}`,
    priority: PRIORITY.BACKGROUND,
  });

  return NextResponse.json({
    ok: true,
    jobId,
    minute,
  });
}
