import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { writeMemory } from "../memory";
import { enqueueNextPhaseArtifacts } from "@/lib/phase-orchestrator";

export async function handlePhaseGenerate(
  db: SupabaseClient,
  job: { id: string; project_id: string; payload: Record<string, unknown> }
) {
  const payload = job.payload ?? {};
  const projectId = (payload.projectId as string) ?? job.project_id;
  const phase = Number(payload.phase);
  const forceRegenerate = Boolean(payload.forceRegenerate);
  const revisionGuidance = (payload.revisionGuidance as string) ?? null;

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "log",
    message: `Phase ${phase}: generating artifacts`,
  });

  await enqueueNextPhaseArtifacts(projectId, phase as 1 | 2 | 3, {
    forceRegenerate,
    revisionGuidance,
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
}
