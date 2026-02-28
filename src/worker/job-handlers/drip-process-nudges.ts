import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { processNudgeEmails } from "@/lib/drip-emails";

export async function handleDripProcessNudges(
  db: SupabaseClient,
  job: { id: string; project_id: string; payload: Record<string, unknown> }
) {
  const summary = await processNudgeEmails();

  await emitJobEvent(db, {
    projectId: job.project_id,
    jobId: job.id,
    type: "artifact",
    message: "Nudge emails processed",
    data: (summary as Record<string, unknown>) ?? {},
  });
}
