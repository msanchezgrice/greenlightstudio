import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { loadMemory, writeMemory } from "../memory";
import { runPhase0, logPhase0Failure } from "@/lib/phase0";

export async function handlePhase0Generate(
  db: SupabaseClient,
  job: { id: string; project_id: string; payload: Record<string, unknown> }
) {
  const payload = job.payload ?? {};
  const projectId = (payload.projectId as string) ?? job.project_id;
  const ownerClerkId = payload.ownerClerkId as string;
  const revisionGuidance = (payload.revisionGuidance as string) ?? null;
  const forceNewApproval = Boolean(payload.forceNewApproval);

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "log",
    message: "Phase 0: initializing",
  });

  const memories = await loadMemory(db, projectId);
  if (memories.length > 0) {
    await emitJobEvent(db, {
      projectId,
      jobId: job.id,
      type: "log",
      message: `Loaded ${memories.length} memory entries for context`,
    });
  }

  try {
    await emitJobEvent(db, {
      projectId,
      jobId: job.id,
      type: "log",
      message: "Phase 0: generating packet",
    });

    await runPhase0({
      projectId,
      userId: ownerClerkId,
      revisionGuidance,
      forceNewApproval,
    });

    await emitJobEvent(db, {
      projectId,
      jobId: job.id,
      type: "artifact",
      message: "Phase 0 packet generated",
    });

    await writeMemory(db, projectId, job.id, [
      {
        category: "decision",
        key: "phase0_completed",
        value: `Phase 0 packet generated successfully at ${new Date().toISOString()}`,
        agentKey: "ceo",
      },
    ]);
  } catch (e) {
    await logPhase0Failure(projectId, e);
    throw e;
  }
}
