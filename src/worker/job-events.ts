import type { SupabaseClient } from "@supabase/supabase-js";
import { recordProjectEvent } from "@/lib/project-events";

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
  const { error } = await db.from("agent_job_events").insert({
    project_id: input.projectId,
    job_id: input.jobId,
    type: input.type,
    message: input.message ?? null,
    data: input.data ?? {},
  });
  if (error) {
    console.error(`[job-events] failed to emit ${input.type} for job ${input.jobId}:`, error.message);
  }

  if (input.type === "status" || input.type === "artifact" || input.type === "done") {
    await recordProjectEvent(db, {
      projectId: input.projectId,
      eventType: `job.${input.type}`,
      message: input.message ?? `${input.type} event`,
      data: {
        job_id: input.jobId,
        type: input.type,
        ...(input.data ?? {}),
      },
      agentKey: "system",
      skipBrainRefresh: true,
    });
  }
}
