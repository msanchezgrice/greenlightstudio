import { createServiceSupabase } from "@/lib/supabase";
import { log_task, save_packet } from "@/lib/supabase-mcp";
import { withRetry } from "@/lib/retry";
import { generatePhase1Packet, generatePhase2Packet, generatePhase3Packet } from "@/lib/agent";

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
  night_shift: boolean;
  scan_results: Record<string, unknown> | null;
};

type PhasePlan = {
  phase: 1 | 2 | 3;
  tasks: Array<{ agent: string; description: string; detail: string }>;
  approval: {
    title: string;
    action_type: string;
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
        },
        {
          agent: "brand_agent",
          description: "phase1_brand_kit",
          detail: `Generate logo + messaging system from idea: ${project.idea_description.slice(0, 140)}`,
        },
        {
          agent: "outreach_agent",
          description: "phase1_waitlist_sequence",
          detail: "Prepare waitlist capture flow and transactional onboarding emails",
        },
      ],
      approval: {
        title: "Phase 1 Validation Plan Ready",
        action_type: "phase1_validate_review",
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
        },
        {
          agent: "outreach_agent",
          description: "phase2_email_campaigns",
          detail: "Prepare nurture and conversion campaigns for leads captured in Phase 1",
        },
        {
          agent: "growth_agent",
          description: "phase2_ads_readiness",
          detail: adsEnabled
            ? `Configure paid acquisition test plan with budget cap $${adsBudgetCap}/day`
            : "Create organic-first distribution plan (ads disabled in permissions)",
        },
      ],
      approval: {
        title: "Phase 2 Distribution Plan Ready",
        action_type: "phase2_distribute_review",
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
      },
      {
        agent: "engineering_agent",
        description: "phase3_build_iteration",
        detail: "Execute scoped build tasks for launch-critical functionality with test coverage",
      },
      {
        agent: "ceo_agent",
        description: "phase3_launch_readiness",
        detail: "Compile go-live readiness report with blockers, risks, and rollback plan",
      },
    ],
    approval: {
      title: "Phase 3 Go-Live Review",
      action_type: "phase3_golive_review",
    },
  };
}

function riskFromConfidence(confidence: number): "high" | "medium" | "low" {
  if (confidence < 40) return "high";
  if (confidence < 70) return "medium";
  return "low";
}

async function generatePacketForPhase(project: ProjectRow, phase: 1 | 2 | 3) {
  const input = {
    project_name: project.name,
    domain: project.domain,
    idea_description: project.idea_description,
    repo_url: project.repo_url,
    runtime_mode: project.runtime_mode,
    permissions: {
      repo_write: Boolean(project.permissions?.repo_write),
      deploy: Boolean(project.permissions?.deploy),
      ads_enabled: Boolean(project.permissions?.ads_enabled),
      ads_budget_cap: Math.max(0, Number(project.permissions?.ads_budget_cap ?? 0)),
      email_send: Boolean(project.permissions?.email_send),
    },
    night_shift: project.night_shift,
    focus_areas: project.focus_areas?.length ? project.focus_areas : ["Market Research", "Landing Page"],
    scan_results: project.scan_results,
  };

  if (phase === 1) return generatePhase1Packet(input);
  if (phase === 2) return generatePhase2Packet(input);
  return generatePhase3Packet(input);
}

export async function enqueueNextPhaseArtifacts(projectId: string, phase: number) {
  if (phase < 1 || phase > 3) return;
  const db = createServiceSupabase();

  const { data: project, error: projectError } = await withRetry(() =>
    db
      .from("projects")
      .select("id,name,domain,idea_description,repo_url,runtime_mode,permissions,focus_areas,night_shift,scan_results")
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

  await withRetry(() =>
    log_task(projectId, "ceo_agent", `phase${plan.phase}_init`, "running", `Initializing Phase ${plan.phase} artifacts`),
  );

  for (const task of plan.tasks) {
    await withRetry(() => log_task(projectId, task.agent, task.description, "running", task.detail));
  }

  const packet = await generatePacketForPhase(project as ProjectRow, plan.phase);
  const packetId = await withRetry(() => save_packet(projectId, plan.phase, packet));
  const confidence = packet.reasoning_synopsis.confidence;
  const risk = riskFromConfidence(confidence);

  for (const task of plan.tasks) {
    await withRetry(() => log_task(projectId, task.agent, task.description, "completed", task.detail));
  }

  await withRetry(() =>
    log_task(
      projectId,
      "ceo_agent",
      `phase${plan.phase}_complete`,
      "completed",
      `Phase ${plan.phase} artifacts generated (${confidence}/100 confidence)`,
    ),
  );

  const { error: insertApprovalError } = await withRetry(() =>
    db.from("approval_queue").insert({
      project_id: projectId,
      packet_id: packetId,
      phase: plan.phase,
      type: "phase_advance",
      title: plan.approval.title,
      description: `Phase ${plan.phase} artifacts generated. CEO confidence: ${confidence}/100.`,
      risk,
      risk_level: risk,
      action_type: plan.approval.action_type,
      agent_source: "ceo_agent",
      payload: packet,
      status: "pending",
    }),
  );

  if (insertApprovalError) throw new Error(insertApprovalError.message);
}
