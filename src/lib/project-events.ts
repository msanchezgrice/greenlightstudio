import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { AGENT_KEYS, JOB_TYPES, PRIORITY } from "@/lib/jobs/constants";

const SYSTEM_PROJECT_ID = "00000000-0000-0000-0000-000000000000";

function truncate(value: string, max = 300) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function eventCategory(eventType: string): "context" | "fact" | "decision" | "learning" {
  if (eventType.startsWith("approval.") || eventType.startsWith("execution.")) return "decision";
  if (eventType.startsWith("analytics.") || eventType.startsWith("payments.")) return "fact";
  if (eventType.startsWith("task.")) return "learning";
  return "context";
}

function eventMessageForMemory(eventType: string, message: string, data: Record<string, unknown>) {
  const suffix = Object.keys(data).length ? ` ${JSON.stringify(data).slice(0, 120)}` : "";
  return truncate(`${eventType}: ${message}${suffix}`, 280);
}

export async function enqueueBrainRefresh(input: {
  projectId: string;
  triggerEventId?: string | null;
  reason?: "event_ingest" | "scheduled_refresh" | "manual";
}) {
  if (!input.projectId || input.projectId === SYSTEM_PROJECT_ID) return null;

  const bucket = Math.floor(Date.now() / 10_000);
  const idempotencyKey = `brain:${input.projectId}:${bucket}`;

  return enqueueJob({
    projectId: input.projectId,
    jobType: JOB_TYPES.BRAIN_REFRESH,
    agentKey: AGENT_KEYS.BRAIN,
    payload: {
      projectId: input.projectId,
      triggerEventId: input.triggerEventId ?? null,
      reason: input.reason ?? "event_ingest",
    },
    idempotencyKey,
    priority: PRIORITY.REALTIME,
  }).catch(() => null);
}

export async function recordProjectEvent(
  db: SupabaseClient,
  input: {
    projectId: string;
    eventType: string;
    message: string;
    data?: Record<string, unknown>;
    agentKey?: string;
    skipMemory?: boolean;
    skipBrainRefresh?: boolean;
    refreshReason?: "event_ingest" | "scheduled_refresh" | "manual";
  },
) {
  const eventData = input.data ?? {};
  const { data: inserted, error } = await db
    .from("project_events")
    .insert({
      project_id: input.projectId,
      event_type: input.eventType,
      message: truncate(input.message, 500),
      data: eventData,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[project-events] failed to insert", error.message);
    return null;
  }

  const eventId = inserted?.id as string;

  if (!input.skipMemory) {
    const now = new Date().toISOString();
    const summary = eventMessageForMemory(input.eventType, input.message, eventData);
    const category = eventCategory(input.eventType);

    const rows = [
      {
        project_id: input.projectId,
        category,
        key: "last_event",
        value: summary,
        source_job_id: null,
        agent_key: input.agentKey ?? AGENT_KEYS.SYSTEM,
        confidence: 1,
        updated_at: now,
      },
      {
        project_id: input.projectId,
        category: "context",
        key: `last_event_${input.eventType.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 64)}`,
        value: summary,
        source_job_id: null,
        agent_key: input.agentKey ?? AGENT_KEYS.SYSTEM,
        confidence: 1,
        updated_at: now,
      },
    ];

    const memoryWrite = await db.from("agent_memory").upsert(rows, {
      onConflict: "project_id,category,key",
    });
    if (memoryWrite.error) {
      console.error("[project-events] failed to write immediate memory", memoryWrite.error.message);
    }
  }

  if (!input.skipBrainRefresh) {
    await enqueueBrainRefresh({
      projectId: input.projectId,
      triggerEventId: eventId,
      reason: input.refreshReason ?? "event_ingest",
    });
  }

  return eventId;
}
