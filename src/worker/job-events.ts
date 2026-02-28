import type { SupabaseClient } from "@supabase/supabase-js";

export type JobEventType =
  | "status"
  | "log"
  | "delta"
  | "tool_call"
  | "tool_result"
  | "artifact"
  | "done";

export async function emitJobEvent(
  db: SupabaseClient,
  input: {
    projectId: string;
    jobId: string;
    type: JobEventType;
    message?: string;
    data?: Record<string, unknown>;
  }
) {
  await db.from("agent_job_events").insert({
    project_id: input.projectId,
    job_id: input.jobId,
    type: input.type,
    message: input.message ?? null,
    data: input.data ?? {},
  });
}
