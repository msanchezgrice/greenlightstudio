import { createServiceSupabase } from "@/lib/supabase";
import { log_task } from "@/lib/supabase-mcp";
import { withRetry } from "@/lib/retry";

type ProjectRow = {
  id: string;
  name: string;
  domain: string | null;
  idea_description: string;
  repo_url: string | null;
  runtime_mode: "shared" | "attached";
  permissions: {
    repo_write?: boolean;
    deploy?: boolean;
    ads_enabled?: boolean;
    ads_budget_cap?: number;
    email_send?: boolean;
  } | null;
  focus_areas: string[] | null;
};

type PhasePlan = {
  phase: 1 | 2 | 3;
  tasks: Array<{ agent: string; description: string; detail: string; status: "queued" | "running" | "completed" | "failed" }>;
  approval: {
    title: string;
    description: string;
    risk: "high" | "medium" | "low";
    action_type: string;
    payload: Record<string, unknown>;
  };
};

function buildPhasePlan(project: ProjectRow, phase: 1 | 2 | 3): PhasePlan {
  const focusAreas = project.focus_areas?.length ? project.focus_areas : ["Market Research", "Landing Page"];
  const permissions = project.permissions ?? {};
  const adsEnabled = Boolean(permissions.ads_enabled);
  const adsBudgetCap = Math.max(0, Number(permissions.ads_budget_cap ?? 0));
  const repoAttached = project.runtime_mode === "attached" && Boolean(project.repo_url);

  if (phase === 1) {
    return {
      phase,
      tasks: [
        {
          agent: "design_agent",
          description: "phase1_landing_page",
          detail: `Draft conversion landing page for ${project.name} focused on ${focusAreas.slice(0, 2).join(" + ")}`,
          status: "queued",
        },
        {
          agent: "brand_agent",
          description: "phase1_brand_kit",
          detail: `Generate logo + messaging system from idea: ${project.idea_description.slice(0, 140)}`,
          status: "queued",
        },
        {
          agent: "outreach_agent",
          description: "phase1_waitlist_sequence",
          detail: "Prepare waitlist capture flow and transactional onboarding emails",
          status: "queued",
        },
      ],
      approval: {
        title: "Phase 1 Validation Plan Ready",
        description:
          "Validation workplan prepared: landing page, waitlist flow, brand kit, and analytics instrumentation. Review before execution.",
        risk: "medium",
        action_type: "phase1_validate_review",
        payload: {
          phase: 1,
          runtime_mode: project.runtime_mode,
          domain: project.domain,
          focus_areas: focusAreas,
          deliverables: ["Landing Page", "Waitlist Flow", "Brand Kit", "Analytics Wiring"],
        },
      },
    };
  }

  if (phase === 2) {
    return {
      phase,
      tasks: [
        {
          agent: "growth_agent",
          description: "phase2_distribution_strategy",
          detail: `Build channel strategy for ${project.name} using ${focusAreas.slice(0, 3).join(", ")}`,
          status: "queued",
        },
        {
          agent: "outreach_agent",
          description: "phase2_email_campaigns",
          detail: "Prepare nurture and conversion campaigns for leads captured in Phase 1",
          status: "queued",
        },
        {
          agent: "growth_agent",
          description: "phase2_ads_readiness",
          detail: adsEnabled
            ? `Configure paid acquisition test plan with budget cap $${adsBudgetCap}/day`
            : "Create organic-first distribution plan (ads disabled in permissions)",
          status: "queued",
        },
      ],
      approval: {
        title: "Phase 2 Distribution Plan Ready",
        description:
          "Distribution plan and campaign sequencing prepared. Approve go-live for outbound channels and paid/organic launch strategy.",
        risk: adsEnabled && adsBudgetCap > 0 ? "high" : "medium",
        action_type: "phase2_distribute_review",
        payload: {
          phase: 2,
          ads_enabled: adsEnabled,
          ads_budget_cap: adsBudgetCap,
          email_send: Boolean(permissions.email_send),
          channels: adsEnabled ? ["Meta Ads", "Email", "Organic Social"] : ["Email", "Organic Social", "Community"],
        },
      },
    };
  }

  return {
    phase,
    tasks: [
      {
        agent: "repo_analyst",
        description: "phase3_architecture_review",
        detail: repoAttached
          ? `Audit attached repo (${project.repo_url}) and produce launch architecture delta`
          : "Design shared-runtime production architecture and launch checklist",
        status: "queued",
      },
      {
        agent: "engineering_agent",
        description: "phase3_build_iteration",
        detail: "Execute scoped build tasks for launch-critical functionality with test coverage",
        status: "queued",
      },
      {
        agent: "ceo_agent",
        description: "phase3_launch_readiness",
        detail: "Compile go-live readiness report with blockers, risks, and rollback plan",
        status: "queued",
      },
    ],
    approval: {
      title: "Phase 3 Go-Live Review",
      description:
        "Launch checklist and engineering execution plan are ready. Approve to continue toward production launch and controlled rollout.",
      risk: "high",
      action_type: "phase3_golive_review",
      payload: {
        phase: 3,
        runtime_mode: project.runtime_mode,
        repo_attached: repoAttached,
        deploy_permission: Boolean(permissions.deploy),
        repo_write_permission: Boolean(permissions.repo_write),
      },
    },
  };
}

export async function enqueueNextPhaseArtifacts(projectId: string, phase: number) {
  if (phase < 1 || phase > 3) return;
  const db = createServiceSupabase();

  const { data: project, error: projectError } = await withRetry(() =>
    db
      .from("projects")
      .select("id,name,domain,idea_description,repo_url,runtime_mode,permissions,focus_areas")
      .eq("id", projectId)
      .single(),
  );

  if (projectError || !project) {
    throw new Error(projectError?.message ?? "Project not found while enqueueing phase artifacts");
  }

  const plan = buildPhasePlan(project as ProjectRow, phase as 1 | 2 | 3);

  const { data: existingApproval, error: approvalLookupError } = await withRetry(() =>
    db
      .from("approval_queue")
      .select("id")
      .eq("project_id", projectId)
      .eq("phase", plan.phase)
      .eq("action_type", plan.approval.action_type)
      .eq("status", "pending")
      .maybeSingle(),
  );

  if (approvalLookupError) throw new Error(approvalLookupError.message);
  if (existingApproval) return;

  for (const task of plan.tasks) {
    await withRetry(() => log_task(projectId, task.agent, task.description, task.status, task.detail));
  }

  const { error: insertApprovalError } = await withRetry(() =>
    db.from("approval_queue").insert({
      project_id: projectId,
      phase: plan.phase,
      type: "phase_advance",
      title: plan.approval.title,
      description: plan.approval.description,
      risk: plan.approval.risk,
      risk_level: plan.approval.risk,
      action_type: plan.approval.action_type,
      agent_source: "ceo_agent",
      payload: plan.approval.payload,
      status: "pending",
    }),
  );

  if (insertApprovalError) throw new Error(insertApprovalError.message);
}
