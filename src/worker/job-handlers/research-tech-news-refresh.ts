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

  const configuredTimeout = Number(process.env.TECH_NEWS_REFRESH_TIMEOUT_MS ?? 300_000);
  const refreshTimeoutMs = Number.isFinite(configuredTimeout) ? Math.max(60_000, configuredTimeout) : 300_000;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, refreshTimeoutMs);

  let result: Awaited<ReturnType<typeof refreshProjectTechNewsInsights>>;
  try {
    result = await refreshProjectTechNewsInsights({
      db,
      projectId,
      reason,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      await emitJobEvent(db, {
        projectId,
        jobId: job.id,
        type: "log",
        message: `Tech-news refresh timed out after ${Math.round(refreshTimeoutMs / 1000)}s`,
        data: { timeout_ms: refreshTimeoutMs, reason },
      });
      throw new Error(`Tech-news refresh timed out after ${Math.round(refreshTimeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }

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
