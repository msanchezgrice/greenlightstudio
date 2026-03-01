import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { writeMemory } from "../memory";
import { deriveNightShiftActions, type NightShiftDerivedAction } from "@/lib/nightshift";
import { parsePhasePacket } from "@/types/phase-packets";
import { assembleCompanyContext } from "@/lib/company-context";
import { recordProjectEvent } from "@/lib/project-events";
import { log_task } from "@/lib/supabase-mcp";
import { withRetry } from "@/lib/retry";

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

  const companyContext = await assembleCompanyContext(db, projectId);

  const latest = await db
    .from("phase_packets")
    .select("id,phase,packet,packet_data")
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
  const rawPacket = (latest.data.packet_data ?? latest.data.packet) as unknown;
  const parsedPacket = parsePhasePacket(packetPhase, rawPacket);

  const actions = deriveNightShiftActions({
    phase: packetPhase,
    packet: parsedPacket,
    repoUrl: (project.data.repo_url as string | null) ?? null,
    runtimeMode: project.data.runtime_mode as "shared" | "attached",
    permissions: (project.data.permissions as Record<string, unknown>) ?? {},
    kpis: companyContext.kpis,
  });

  const actionable = actions.filter(
    (
      action,
    ): action is NightShiftDerivedAction & { approval: NonNullable<NightShiftDerivedAction["approval"]> } =>
      Boolean(action.approval),
  );
  let enqueuedApprovals = 0;

  if (actionable.length) {
    const actionTypes = Array.from(new Set(actionable.map((action) => action.approval.action_type)));
    const existing = await db
      .from("approval_queue")
      .select("action_type")
      .eq("project_id", projectId)
      .eq("status", "pending")
      .in("action_type", actionTypes);
    if (existing.error) throw new Error(existing.error.message);

    const existingActionTypes = new Set((existing.data ?? []).map((row) => String(row.action_type)));
    for (const action of actionable) {
      if (existingActionTypes.has(action.approval.action_type)) continue;

      const { error: insertError } = await db.from("approval_queue").insert({
        project_id: projectId,
        packet_id: latest.data.id,
        phase: packetPhase,
        type: "execution",
        title: action.approval.title,
        description: action.description,
        risk: action.approval.risk,
        risk_level: action.approval.risk,
        action_type: action.approval.action_type,
        agent_source: "night_shift",
        payload: {
          source: "nightshift",
          phase: packetPhase,
          derived_action: action.description,
        },
        status: "pending",
      });
      if (insertError) throw new Error(insertError.message);

      existingActionTypes.add(action.approval.action_type);
      enqueuedApprovals += 1;
    }
  }

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "artifact",
    message: `Nightshift cycle complete: ${actions?.length ?? 0} actions derived, ${enqueuedApprovals} approvals queued`,
  });

  const prioritizedRecommendations = actions.slice(0, 5).map((action, index) => ({
    priority: index + 1,
    description: action.description,
    approval_action_type: action.approval?.action_type ?? null,
  }));

  const summaryDetail = prioritizedRecommendations.length
    ? prioritizedRecommendations
      .map((recommendation) =>
        `P${recommendation.priority}: ${recommendation.description}${recommendation.approval_action_type ? ` -> ${recommendation.approval_action_type}` : ""}`,
      )
      .join(" | ")
    : "No recommendations generated in this cycle.";

  await withRetry(() =>
    log_task(
      projectId,
      "night_shift",
      "nightshift_summary",
      "completed",
      `${summaryDetail} | approvals_queued=${enqueuedApprovals}`,
    ),
  );

  await recordProjectEvent(db, {
    projectId,
    eventType: "nightshift.cycle_completed",
    message: `Night shift cycle completed (${actions.length} actions, ${enqueuedApprovals} approvals)`,
    data: {
      actions: actions.length,
      approvals_queued: enqueuedApprovals,
      kpis: companyContext.kpis,
    },
    agentKey: "night_shift",
  });

  await recordProjectEvent(db, {
    projectId,
    eventType: "nightshift.recommendations_generated",
    message: `Night shift produced ${prioritizedRecommendations.length} prioritized recommendations`,
    data: {
      recommendations: prioritizedRecommendations,
      approvals_queued: enqueuedApprovals,
      kpis: companyContext.kpis,
    },
    agentKey: "night_shift",
  });

  if (actions?.length) {
    await writeMemory(db, projectId, job.id, [
      {
        category: "context",
        key: "last_nightshift",
        value: `Nightshift ran at ${new Date().toISOString()}: ${actions.length} actions, ${enqueuedApprovals} approvals queued, leads_7d=${companyContext.kpis.leads_7d}, revenue_30d=${companyContext.kpis.revenue_cents_30d}`,
        agentKey: "night_shift",
      },
      {
        category: "decision",
        key: "nightshift_top_recommendations",
        value: summaryDetail.slice(0, 500),
        agentKey: "night_shift",
      },
    ]);
  }
}
