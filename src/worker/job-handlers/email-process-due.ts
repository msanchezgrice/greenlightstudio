import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { processDueEmailJobs } from "@/lib/action-execution";

export async function handleEmailProcessDue(
  db: SupabaseClient,
  job: { id: string; project_id: string; payload: Record<string, unknown> }
) {
  const payload = job.payload ?? {};
  const limit = Math.max(1, Number(payload.limit ?? 100));

  const summary = await processDueEmailJobs(limit);

  await emitJobEvent(db, {
    projectId: job.project_id,
    jobId: job.id,
    type: "artifact",
    message: "Email jobs processed",
    data: (summary as Record<string, unknown>) ?? {},
  });
}
