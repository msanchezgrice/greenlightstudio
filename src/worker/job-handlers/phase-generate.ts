import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { loadMemory, writeMemory } from "../memory";
import { enqueueNextPhaseArtifacts } from "@/lib/phase-orchestrator";
import { assembleCompanyContext, companyContextToMarkdown } from "@/lib/company-context";
import { recordProjectEvent } from "@/lib/project-events";

export async function handlePhaseGenerate(
  db: SupabaseClient,
  job: { id: string; project_id: string; payload: Record<string, unknown> }
) {
  const payload = job.payload ?? {};
  const projectId = (payload.projectId as string) ?? job.project_id;
  const phase = Number(payload.phase);
  const forceRegenerate = Boolean(payload.forceRegenerate);
  const revisionGuidance = (payload.revisionGuidance as string) ?? null;

  const memories = await loadMemory(db, projectId);
  const companyContext = await assembleCompanyContext(db, projectId);
  const companyContextSummary = companyContextToMarkdown(companyContext);

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "log",
    message: `Phase ${phase}: generating artifacts (${memories.length} memories loaded)`,
  });

  await enqueueNextPhaseArtifacts(projectId, phase as 1 | 2 | 3, {
    forceRegenerate,
    revisionGuidance,
    companyContextSummary,
  });

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "artifact",
    message: `Phase ${phase} packet generated`,
  });

  await writeMemory(db, projectId, job.id, [
    {
      category: "decision",
      key: `phase${phase}_completed`,
      value: `Phase ${phase} packet generated at ${new Date().toISOString()}`,
      agentKey: "ceo",
    },
  ]);

  await recordProjectEvent(db, {
    projectId,
    eventType: "phase.packet_generated",
    message: `Phase ${phase} packet generated`,
    data: {
      phase,
      revision_guidance: revisionGuidance ? String(revisionGuidance).slice(0, 140) : null,
    },
    agentKey: "ceo",
  });
}
