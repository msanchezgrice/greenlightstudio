import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { refreshCompanyBrain } from "@/lib/brain";
import { recordProjectEvent } from "@/lib/project-events";

export async function handleBrainRefresh(
  db: SupabaseClient,
  job: { id: string; project_id: string; payload: Record<string, unknown> },
) {
  const payload = job.payload ?? {};
  const projectId = (payload.projectId as string) ?? job.project_id;
  const reason = (payload.reason as "event_ingest" | "scheduled_refresh" | "manual") ?? "event_ingest";
  const triggerEventId = (payload.triggerEventId as string | null | undefined) ?? null;

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "log",
    message: `Refreshing company brain (${reason})`,
  });

  const result = await refreshCompanyBrain({
    db,
    projectId,
    reason,
    triggerEventId,
    writeMemoryAsset: true,
  });

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "artifact",
    message: `Brain refreshed to v${result.memoryVersion}`,
    data: {
      memory_version: result.memoryVersion,
      delta_events: result.deltaEvents,
    },
  });

  await recordProjectEvent(db, {
    projectId,
    eventType: "brain.refreshed",
    message: `Company brain refreshed (v${result.memoryVersion})`,
    data: {
      reason,
      trigger_event_id: triggerEventId,
      delta_events: result.deltaEvents,
      memory_version: result.memoryVersion,
    },
    agentKey: "brain",
    skipBrainRefresh: true,
  });
}
