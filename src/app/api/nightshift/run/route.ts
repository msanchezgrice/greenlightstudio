import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase";
import { log_task } from "@/lib/supabase-mcp";
import { withRetry } from "@/lib/retry";
import { processDueEmailJobs } from "@/lib/action-execution";
import { parsePhasePacket } from "@/types/phase-packets";
import { deriveNightShiftActions } from "@/lib/nightshift";
import { processWeeklyDigests, processNudgeEmails } from "@/lib/drip-emails";

export const runtime = "nodejs";
export const maxDuration = 800;

type ProjectRow = {
  id: string;
  name: string;
  phase: number;
  repo_url: string | null;
  runtime_mode: "shared" | "attached";
  permissions: {
    repo_write?: boolean;
    deploy?: boolean;
    ads_enabled?: boolean;
    ads_budget_cap?: number;
    email_send?: boolean;
  } | null;
};

type PacketRow = {
  id: string;
  phase: number;
  packet: unknown;
};

async function hasExistingExecutionApproval(input: {
  projectId: string;
  phase: number;
  actionType: string;
}) {
  const db = createServiceSupabase();
  const { data, error } = await withRetry(() =>
    db
      .from("approval_queue")
      .select("id")
      .eq("project_id", input.projectId)
      .eq("phase", input.phase)
      .eq("action_type", input.actionType)
      .in("status", ["pending", "approved"])
      .limit(1)
      .maybeSingle(),
  );
  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function queueExecutionApproval(input: {
  projectId: string;
  phase: number;
  packetId: string;
  actionType: string;
  title: string;
  description: string;
  risk: "high" | "medium" | "low";
  payload: Record<string, unknown>;
}) {
  if (
    await hasExistingExecutionApproval({
      projectId: input.projectId,
      phase: input.phase,
      actionType: input.actionType,
    })
  ) {
    return false;
  }

  const db = createServiceSupabase();
  const { error } = await withRetry(() =>
    db.from("approval_queue").insert({
      project_id: input.projectId,
      packet_id: input.packetId,
      phase: input.phase,
      type: "execution",
      title: input.title,
      description: input.description,
      risk: input.risk,
      risk_level: input.risk,
      action_type: input.actionType,
      agent_source: "night_shift",
      payload: input.payload,
      status: "pending",
    }),
  );

  if (error) throw new Error(error.message);
  return true;
}

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

  let emailJobSummary: { queued: number; sent: number; failed: number } | null = null;
  let emailJobError: string | null = null;

  try {
    emailJobSummary = await processDueEmailJobs(100);
  } catch (error) {
    emailJobError = error instanceof Error ? error.message : "Failed processing email jobs";
  }

  const db = createServiceSupabase();

  const { data: projects, error: projectsError } = await withRetry(() =>
    db
      .from("projects")
      .select("id,name,phase,repo_url,runtime_mode,permissions,night_shift")
      .eq("night_shift", true)
      .order("updated_at", { ascending: true })
      .limit(50),
  );

  if (projectsError) {
    return NextResponse.json({ error: projectsError.message }, { status: 400 });
  }

  const results: Array<{ project_id: string; status: string; detail: string }> = [];

  for (const project of projects ?? []) {
    const projectId = project.id as string;
    const projectRow = project as ProjectRow;

    try {
      await withRetry(() => log_task(projectId, "night_shift", "nightshift_health_check", "running", "Health check started"));

      const { count: pendingApprovals, error: approvalsError } = await withRetry(() =>
        db
          .from("approval_queue")
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId)
          .eq("status", "pending"),
      );

      if (approvalsError) {
        throw new Error(approvalsError.message);
      }

      if ((pendingApprovals ?? 0) > 0) {
        await withRetry(() =>
          log_task(
            projectId,
            "night_shift",
            "nightshift_skipped",
            "completed",
            `Skipped: ${pendingApprovals} pending approvals in inbox`,
          ),
        );

        results.push({
          project_id: projectId,
          status: "skipped",
          detail: `Pending approvals: ${pendingApprovals}`,
        });
        continue;
      }

      const { data: packetRow, error: packetError } = await withRetry(() =>
        db
          .from("phase_packets")
          .select("id,phase,packet")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      );

      if (packetError) {
        throw new Error(packetError.message);
      }
      if (!packetRow) {
        await withRetry(() => log_task(projectId, "night_shift", "nightshift_skipped", "completed", "Skipped: no packet found"));
        results.push({
          project_id: projectId,
          status: "skipped",
          detail: "No packet available",
        });
        continue;
      }

      const packetPhase = Number((packetRow as PacketRow).phase);
      const parsedPacket = parsePhasePacket(packetPhase, (packetRow as PacketRow).packet);
      const actions = deriveNightShiftActions({
        phase: packetPhase,
        packet: parsedPacket,
        repoUrl: projectRow.repo_url,
        runtimeMode: projectRow.runtime_mode,
        permissions: projectRow.permissions ?? {},
      });

      let queuedApprovals = 0;
      let completedActions = 0;

      for (let index = 0; index < actions.length; index += 1) {
        const action = actions[index];
        const description = `nightshift_phase${packetPhase}_action_${index + 1}`;
        await withRetry(() => log_task(projectId, "night_shift", description, "running", action.description));

        if (action.approval) {
          const queued = await queueExecutionApproval({
            projectId,
            phase: packetPhase,
            packetId: (packetRow as PacketRow).id,
            actionType: action.approval.action_type,
            title: action.approval.title,
            description: action.description,
            risk: action.approval.risk,
            payload: {
              source: "night_shift",
              phase_packet: parsedPacket,
              generated_from: action.description,
            },
          });
          if (queued) queuedApprovals += 1;
        }

        await withRetry(() =>
          log_task(
            projectId,
            "night_shift",
            description,
            "completed",
            action.approval ? `${action.description} (approval queued)` : action.description,
          ),
        );
        completedActions += 1;
      }

      const { data: recentTasks, error: recentError } = await withRetry(() =>
        db
          .from("tasks")
          .select("status")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(20),
      );

      if (recentError) {
        throw new Error(recentError.message);
      }

      const completedCount = (recentTasks ?? []).filter((task) => task.status === "completed").length;
      const failedCount = (recentTasks ?? []).filter((task) => task.status === "failed").length;

      await withRetry(() =>
        log_task(
          projectId,
          "night_shift",
          "nightshift_summary",
          "completed",
          `While You Were Away: ${completedCount} completed, ${failedCount} failed, ${completedActions} night actions, ${queuedApprovals} approvals queued`,
        ),
      );

      if (failedCount > 0) {
        const { error: queueError } = await withRetry(() =>
          db.from("approval_queue").insert({
            project_id: projectId,
            phase: 0,
            type: "phase_advance",
            title: "Night Shift Failure Review",
            description: `Night Shift detected ${failedCount} failed tasks. Review before next cycle.`,
            risk: "medium",
            risk_level: "medium",
            action_type: "nightshift_failure_review",
            agent_source: "night_shift",
            payload: { failed_count: failedCount },
          }),
        );

        if (queueError) {
          throw new Error(queueError.message);
        }
      }

      results.push({
        project_id: projectId,
        status: "completed",
        detail: `Summary generated (completed=${completedCount}, failed=${failedCount}, actions=${completedActions}, approvals=${queuedApprovals})`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Night Shift error";
      await withRetry(() => log_task(projectId, "night_shift", "nightshift_failed", "failed", message));
      results.push({ project_id: projectId, status: "failed", detail: message });
    }
  }

  let dripDigest: Awaited<ReturnType<typeof processWeeklyDigests>> | null = null;
  let dripNudge: Awaited<ReturnType<typeof processNudgeEmails>> | null = null;
  let dripError: string | null = null;

  try {
    if (typeof processWeeklyDigests === "function") {
      dripDigest = await processWeeklyDigests();
    }
    if (typeof processNudgeEmails === "function") {
      dripNudge = await processNudgeEmails();
    }
  } catch (error) {
    dripError = error instanceof Error ? error.message : "Failed processing drip emails";
  }

  return NextResponse.json({
    ran_at: new Date().toISOString(),
    project_count: projects?.length ?? 0,
    email_jobs: emailJobSummary,
    email_jobs_error: emailJobError,
    drip_digest: dripDigest,
    drip_nudge: dripNudge,
    drip_error: dripError,
    results,
  });
}
