import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { refreshProjectTechNewsInsights } from "@/lib/tech-news";

export async function handleResearchTechNewsRefresh(
  db: SupabaseClient,
  job: { id: string; project_id: string; payload: Record<string, unknown> },
) {
  const payload = job.payload ?? {};
  const projectId = (payload.projectId as string) ?? job.project_id;
  const reasonRaw = typeof payload.reason === "string" ? payload.reason : "scheduled";
  const reason = reasonRaw === "phase0" || reasonRaw === "nightshift" || reasonRaw === "manual"
    ? reasonRaw
    : "scheduled";

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "log",
    message: `Refreshing tech-news insights (${reason})`,
  });

  const result = await refreshProjectTechNewsInsights({
    db,
    projectId,
    reason,
  });

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "artifact",
    message: `Tech-news refresh complete (${result.insight.advances.length} advances)`,
    data: {
      advances: result.insight.advances.length,
      asset_id: result.assetId,
    },
  });
}
