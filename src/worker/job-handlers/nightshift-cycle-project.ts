import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { writeMemory } from "../memory";
import { deriveNightShiftActions } from "@/lib/nightshift";
import { parsePhasePacket } from "@/types/phase-packets";

export async function handleNightshiftCycleProject(
  db: SupabaseClient,
  job: { id: string; project_id: string; payload: Record<string, unknown> }
) {
  const payload = job.payload ?? {};
  const projectId = (payload.projectId as string) ?? job.project_id;

  const pending = await db
    .from("approval_queue")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("status", "pending");

  const pendingCount = pending.count ?? 0;
  if (pendingCount > 0) {
    await emitJobEvent(db, {
      projectId,
      jobId: job.id,
      type: "log",
      message: `Skipping nightshift: ${pendingCount} pending approvals`,
    });
    return;
  }

  const project = await db
    .from("projects")
    .select("id,name,domain,phase,permissions,repo_url,runtime_mode,owner_clerk_id")
    .eq("id", projectId)
    .single();
  if (project.error || !project.data) throw new Error("Project not found");

  const latest = await db
    .from("phase_packets")
    .select("id,phase,packet")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latest.data) {
    await emitJobEvent(db, {
      projectId,
      jobId: job.id,
      type: "log",
      message: "No phase packet found; skipping",
    });
    return;
  }

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "log",
    message: "Deriving nightshift actions",
  });

  const packetPhase = Number(latest.data.phase);
  const parsedPacket = parsePhasePacket(packetPhase, latest.data.packet);

  const actions = deriveNightShiftActions({
    phase: packetPhase,
    packet: parsedPacket,
    repoUrl: (project.data.repo_url as string | null) ?? null,
    runtimeMode: project.data.runtime_mode as "shared" | "attached",
    permissions: (project.data.permissions as Record<string, unknown>) ?? {},
  });

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "artifact",
    message: `Nightshift cycle complete: ${actions?.length ?? 0} actions derived`,
  });

  if (actions?.length) {
    await writeMemory(db, projectId, job.id, [
      {
        category: "context",
        key: "last_nightshift",
        value: `Nightshift ran at ${new Date().toISOString()}: ${actions.length} actions`,
        agentKey: "night_shift",
      },
    ]);
  }
}
