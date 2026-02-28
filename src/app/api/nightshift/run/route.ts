import { after } from "next/server";
import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { JOB_TYPES, AGENT_KEYS, PRIORITY, SYSTEM_PROJECT_ID } from "@/lib/jobs/constants";
import { processDueEmailJobs } from "@/lib/action-execution";
import { processWeeklyDigests, processNudgeEmails } from "@/lib/drip-emails";
import { deriveNightShiftActions } from "@/lib/nightshift";
import { parsePhasePacket } from "@/types/phase-packets";
import { log_task } from "@/lib/supabase-mcp";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function GET(req: Request) {
  return nightShiftHandler(req);
}

export async function POST(req: Request) {
  return nightShiftHandler(req);
}

async function nightShiftHandler(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const nightShiftSecret = process.env.NIGHT_SHIFT_SECRET;
  const url = new URL(req.url);
  const provided = req.headers.get("x-night-shift-secret") ?? url.searchParams.get("secret");
  const authHeader = req.headers.get("authorization");
  const authorizedByCron = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);
  const authorizedByNightShift = Boolean(nightShiftSecret && provided === nightShiftSecret);

  if (!authorizedByCron && !authorizedByNightShift) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceSupabase();

  const { data: projects, error: projectsError } = await withRetry(() =>
    db
      .from("projects")
      .select("id")
      .eq("night_shift", true)
      .order("updated_at", { ascending: true })
      .limit(50),
  );

  if (projectsError) {
    return NextResponse.json({ error: projectsError.message }, { status: 400 });
  }

  const enqueued: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const project of projects ?? []) {
    const projectId = project.id as string;
    try {
      const jobId = await enqueueJob({
        projectId,
        jobType: JOB_TYPES.NIGHTSHIFT,
        agentKey: AGENT_KEYS.NIGHTSHIFT,
        payload: { projectId },
        idempotencyKey: `nightshift:${projectId}:${today}`,
        priority: PRIORITY.BACKGROUND,
      });
      enqueued.push(jobId);
    } catch {}
  }

  try {
    await enqueueJob({
      projectId: SYSTEM_PROJECT_ID,
      jobType: JOB_TYPES.EMAIL_DUE,
      agentKey: AGENT_KEYS.SYSTEM,
      payload: { limit: 100 },
      idempotencyKey: `email:${today}`,
      priority: PRIORITY.BACKGROUND,
    });
  } catch {}

  try {
    await enqueueJob({
      projectId: SYSTEM_PROJECT_ID,
      jobType: JOB_TYPES.DRIP_DIGESTS,
      agentKey: AGENT_KEYS.SYSTEM,
      payload: {},
      idempotencyKey: `drip-digests:${today}`,
      priority: PRIORITY.BACKGROUND,
    });
  } catch {}

  try {
    await enqueueJob({
      projectId: SYSTEM_PROJECT_ID,
      jobType: JOB_TYPES.DRIP_NUDGES,
      agentKey: AGENT_KEYS.SYSTEM,
      payload: {},
      idempotencyKey: `drip-nudges:${today}`,
      priority: PRIORITY.BACKGROUND,
    });
  } catch {}

  after(async () => {
    try { await processDueEmailJobs(100); } catch (e) { console.error("[nightshift] email processing failed:", e); }
    try { await processWeeklyDigests(); } catch (e) { console.error("[nightshift] weekly digests failed:", e); }
    try { await processNudgeEmails(); } catch (e) { console.error("[nightshift] nudge emails failed:", e); }

    for (const proj of projects ?? []) {
      const pid = proj.id as string;
      try {
        const nsDb = createServiceSupabase();
        const pending = await nsDb.from("approval_queue").select("id").eq("project_id", pid).eq("status", "pending").limit(1);
        if (pending.data?.length) continue;

        const projRow = await nsDb.from("projects").select("id,phase,runtime_mode,permissions,repo_url").eq("id", pid).single();
        if (!projRow.data) continue;

        const packet = await nsDb.from("phase_packets").select("packet_json,phase")
          .eq("project_id", pid).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (!packet.data?.packet_json) continue;

        const actions = deriveNightShiftActions({
          phase: packet.data.phase,
          packet: parsePhasePacket(packet.data.phase, packet.data.packet_json),
          runtimeMode: projRow.data.runtime_mode,
          permissions: projRow.data.permissions as Record<string, unknown>,
          repoUrl: projRow.data.repo_url,
        });
        if (!actions?.length) continue;

        for (const action of actions) {
          if (!action.approval) continue;
          await nsDb.from("approval_queue").insert({
            project_id: pid,
            phase: projRow.data.phase,
            action_type: action.approval.action_type,
            title: action.approval.title,
            risk: action.approval.risk,
            payload: {},
            status: "pending",
          });
        }
        await log_task(pid, "night_shift", "nightshift_cycle", "completed", `Derived ${actions.length} actions`);
      } catch (e) {
        console.error(`[nightshift] project ${pid} failed:`, e);
      }
    }
  });

  return NextResponse.json({
    ran_at: new Date().toISOString(),
    project_count: projects?.length ?? 0,
    jobs_enqueued: enqueued.length + 3,
  });
}
