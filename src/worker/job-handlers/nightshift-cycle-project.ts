import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { writeMemory } from "../memory";
import { deriveNightShiftActions, type NightShiftDerivedAction } from "@/lib/nightshift";
import { parsePhasePacket } from "@/types/phase-packets";
import { assembleCompanyContext } from "@/lib/company-context";
import { recordProjectEvent } from "@/lib/project-events";
import { log_task } from "@/lib/supabase-mcp";
import { withRetry } from "@/lib/retry";
import { sendResendEmail } from "@/lib/integrations";
import { dailyOverviewEmail } from "@/lib/email-templates";

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

  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);
  const overviewSentToday = await db
    .from("project_events")
    .select("id")
    .eq("project_id", projectId)
    .eq("event_type", "email.daily_overview.sent")
    .gte("created_at", startOfDayUtc.toISOString())
    .limit(1);

  if (!overviewSentToday.error && (overviewSentToday.data ?? []).length === 0) {
    const ownerRes = await db
      .from("users")
      .select("email")
      .eq("clerk_id", project.data.owner_clerk_id)
      .maybeSingle();
    const ownerEmail = typeof ownerRes.data?.email === "string" ? ownerRes.data.email.trim() : "";

    if (ownerEmail) {
      const summaryLines = [
        `${actions.length} recommendations generated; ${enqueuedApprovals} approval task${enqueuedApprovals === 1 ? "" : "s"} queued.`,
        `Traffic (7d): ${companyContext.kpis.traffic_7d} · Leads (7d): ${companyContext.kpis.leads_7d} · Revenue (30d): $${(companyContext.kpis.revenue_cents_30d / 100).toFixed(2)}.`,
        `Current phase: ${project.data.phase}.`,
      ];

      const aiTasks = prioritizedRecommendations
        .slice(0, 3)
        .map((item) => item.description)
        .filter((value) => value.trim().length > 0);
      while (aiTasks.length < 3) {
        aiTasks.push("Continue executing approved roadmap tasks and refresh recommendations.");
      }

      const userTasks: string[] = [];
      if (enqueuedApprovals > 0) {
        userTasks.push(`Review ${enqueuedApprovals} pending approval task${enqueuedApprovals === 1 ? "" : "s"} in Inbox.`);
      }
      if (companyContext.kpis.leads_7d === 0) {
        userTasks.push("Refine landing page copy and CTA for lead capture.");
      } else if (companyContext.kpis.conversion_proxy_7d < 0.03) {
        userTasks.push("Approve a conversion-focused landing page experiment.");
      } else {
        userTasks.push("Approve one growth experiment to improve acquisition efficiency.");
      }
      if (companyContext.kpis.revenue_cents_30d === 0) {
        userTasks.push("Define or approve a first revenue test offer.");
      } else {
        userTasks.push("Review monetization KPIs and set a near-term revenue target.");
      }
      while (userTasks.length < 3) {
        userTasks.push("Review the phase workspace and confirm tomorrow's priorities.");
      }

      const appBaseUrl =
        process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ||
        process.env.APP_BASE_URL?.trim().replace(/\/+$/, "") ||
        "https://startupmachine.ai";
      const emailContent = dailyOverviewEmail({
        projectName: project.data.name as string,
        projectId,
        baseUrl: appBaseUrl,
        summaryLines,
        aiTasks: aiTasks.slice(0, 3),
        userTasks: userTasks.slice(0, 3),
      });

      try {
        const sent = await sendResendEmail({
          to: ownerEmail,
          subject: emailContent.subject,
          html: emailContent.html,
          projectId,
        });
        await recordProjectEvent(db, {
          projectId,
          eventType: "email.daily_overview.sent",
          message: `Daily overview sent to ${ownerEmail}`,
          data: {
            to_email: ownerEmail,
            resend_id: sent.id,
            recommendations_count: prioritizedRecommendations.length,
            approvals_queued: enqueuedApprovals,
          },
          agentKey: "night_shift",
        });
      } catch (error) {
        await recordProjectEvent(db, {
          projectId,
          eventType: "email.daily_overview.failed",
          message: "Daily overview email failed",
          data: {
            to_email: ownerEmail,
            error: error instanceof Error ? error.message : "Unknown email failure",
          },
          agentKey: "night_shift",
        });
      }
    }
  }

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
