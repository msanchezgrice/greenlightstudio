import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { PRIORITY } from "@/lib/jobs/constants";
import { computeNextRunAt } from "@/lib/recurring";
import { recordProjectEvent, enqueueBrainRefresh } from "@/lib/project-events";

function minuteBucket(date = new Date()) {
  return date.toISOString().slice(0, 16);
}

export async function handleSchedulerRunRecurring(
  db: SupabaseClient,
  job: { id: string; project_id: string; payload: Record<string, unknown> },
) {
  const payload = job.payload ?? {};
  const limit = Math.max(1, Math.min(250, Number(payload.limit ?? 100)));
  const nowIso = new Date().toISOString();

  const { data: dueRows, error } = await db
    .from("project_recurring_tasks")
    .select("id,project_id,task_key,cron_expr,timezone,job_type,agent_key,payload,priority,next_run_at")
    .eq("enabled", true)
    .lte("next_run_at", nowIso)
    .order("next_run_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);

  let enqueued = 0;

  for (const row of dueRows ?? []) {
    const projectId = String(row.project_id);
    const taskId = String(row.id);
    const taskKey = String(row.task_key);
    const cronExpr = String(row.cron_expr);
    const timezone = (row.timezone as string | null) ?? "UTC";

    const idempotencyKey = `recur:${taskId}:${minuteBucket()}`;
    try {
      await enqueueJob({
        projectId,
        jobType: String(row.job_type),
        agentKey: String(row.agent_key),
        payload: {
          ...(row.payload as Record<string, unknown>),
          projectId,
          recurringTaskId: taskId,
          recurringTaskKey: taskKey,
          scheduledFrom: row.next_run_at,
        },
        idempotencyKey,
        priority: Number(row.priority ?? PRIORITY.BACKGROUND),
      });
      enqueued += 1;

      const nextRunAt = computeNextRunAt({
        cronExpr,
        timezone,
      }).toISOString();

      await db
        .from("project_recurring_tasks")
        .update({
          last_run_at: new Date().toISOString(),
          next_run_at: nextRunAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", taskId);

      await recordProjectEvent(db, {
        projectId,
        eventType: "recurring_task.enqueued",
        message: `Recurring task ${taskKey} enqueued`,
        data: {
          recurring_task_id: taskId,
          task_key: taskKey,
          job_type: row.job_type,
          agent_key: row.agent_key,
          next_run_at: nextRunAt,
        },
        agentKey: "system",
      });

      await enqueueBrainRefresh({
        projectId,
        reason: "scheduled_refresh",
      });
    } catch (enqueueError) {
      await recordProjectEvent(db, {
        projectId,
        eventType: "recurring_task.failed",
        message: `Failed to enqueue recurring task ${taskKey}`,
        data: {
          recurring_task_id: taskId,
          error: enqueueError instanceof Error ? enqueueError.message : "enqueue failed",
        },
        agentKey: "system",
      });
    }
  }

  await emitJobEvent(db, {
    projectId: job.project_id,
    jobId: job.id,
    type: "artifact",
    message: `Recurring scheduler run complete (${enqueued} enqueued)`,
    data: {
      enqueued,
      scanned: (dueRows ?? []).length,
    },
  });
}
