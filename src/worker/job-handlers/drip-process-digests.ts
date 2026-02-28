import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { processWeeklyDigests } from "@/lib/drip-emails";

export async function handleDripProcessDigests(
  db: SupabaseClient,
  job: { id: string; project_id: string; payload: Record<string, unknown> }
) {
  const summary = await processWeeklyDigests();

  await emitJobEvent(db, {
    projectId: job.project_id,
    jobId: job.id,
    type: "artifact",
    message: "Weekly digests processed",
    data: (summary as Record<string, unknown>) ?? {},
  });
}
