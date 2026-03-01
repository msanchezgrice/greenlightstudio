import type { PhasePacket } from "@/types/phase-packets";

type ProjectPermissions = {
  repo_write?: boolean;
  deploy?: boolean;
  ads_enabled?: boolean;
  ads_budget_cap?: number;
  email_send?: boolean;
};

type DerivedApproval = {
  action_type:
    | "deploy_landing_page"
    | "send_welcome_email_sequence"
    | "send_phase2_lifecycle_email"
    | "activate_meta_ads_campaign"
    | "trigger_phase3_repo_workflow"
    | "trigger_phase3_deploy";
  title: string;
  risk: "high" | "medium" | "low";
};

export type NightShiftDerivedAction = {
  description: string;
  approval: DerivedApproval | null;
};

function nextActionsFromPacket(packet: PhasePacket): string[] {
  const actions = packet.reasoning_synopsis?.next_actions ?? [];
  return actions
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 5);
}

function includesAny(value: string, fragments: string[]) {
  return fragments.some((fragment) => value.includes(fragment));
}

function resolveApprovalFromAction(input: {
  phase: number;
  action: string;
  repoUrl: string | null;
  runtimeMode: "shared" | "attached";
  permissions: ProjectPermissions;
}): DerivedApproval | null {
  const text = input.action.toLowerCase();
  const permissions = input.permissions;

  if (
    input.phase >= 2 &&
    permissions.ads_enabled &&
    Number(permissions.ads_budget_cap ?? 0) > 0 &&
    includesAny(text, ["meta", "ads", "ad campaign", "paid", "acquisition"])
  ) {
    return {
      action_type: "activate_meta_ads_campaign",
      title: "Night Shift: Activate Meta Ads Campaign",
      risk: "high",
    };
  }

  if (permissions.email_send && includesAny(text, ["email", "outreach", "newsletter", "sequence"])) {
    return {
      action_type: input.phase >= 2 ? "send_phase2_lifecycle_email" : "send_welcome_email_sequence",
      title: input.phase >= 2 ? "Night Shift: Send Lifecycle Email" : "Night Shift: Send Welcome Sequence",
      risk: "low",
    };
  }

  if (
    input.phase >= 3 &&
    permissions.repo_write &&
    Boolean(input.repoUrl) &&
    includesAny(text, ["repo", "repository", "workflow", "pull request", "merge", "branch"])
  ) {
    return {
      action_type: "trigger_phase3_repo_workflow",
      title: "Night Shift: Trigger Repo Workflow",
      risk: "high",
    };
  }

  if (includesAny(text, ["deploy", "launch", "go live", "release"])) {
    if (input.phase >= 3 && permissions.deploy) {
      return {
        action_type: "trigger_phase3_deploy",
        title: "Night Shift: Trigger Phase 3 Deploy",
        risk: "high",
      };
    }

    if (input.phase >= 1 && input.runtimeMode === "shared") {
      return {
        action_type: "deploy_landing_page",
        title: "Night Shift: Deploy Shared Runtime Landing",
        risk: "medium",
      };
    }
  }

  return null;
}

export function deriveNightShiftActions(input: {
  phase: number;
  packet: PhasePacket;
  runtimeMode: "shared" | "attached";
  permissions: ProjectPermissions;
  repoUrl: string | null;
  kpis?: {
    traffic_7d: number;
    traffic_30d: number;
    leads_7d: number;
    leads_30d: number;
    payments_succeeded_7d: number;
    payments_succeeded_30d: number;
    revenue_cents_7d: number;
    revenue_cents_30d: number;
  };
}): NightShiftDerivedAction[] {
  const nextActions = nextActionsFromPacket(input.packet);
  const kpis = input.kpis;

  if (kpis) {
    if (kpis.traffic_7d > 0 && kpis.leads_7d === 0) {
      nextActions.push("Optimize landing page conversion and launch an updated lifecycle email sequence");
    }
    if (kpis.traffic_7d === 0 && kpis.leads_7d === 0) {
      nextActions.push("Increase top-of-funnel distribution with outreach and social posting this week");
    }
    if (kpis.leads_30d > 20 && kpis.payments_succeeded_30d === 0) {
      nextActions.push("Launch conversion-focused lifecycle email and paid re-engagement test");
    }
    if (kpis.payments_succeeded_30d > 0 && kpis.revenue_cents_30d > 0) {
      nextActions.push("Scale successful channel performance while preserving quality and support throughput");
    }
  }
  const seenApprovalTypes = new Set<string>();

  return nextActions.slice(0, 3).map((action) => {
    const approval = resolveApprovalFromAction({
      phase: input.phase,
      action,
      repoUrl: input.repoUrl,
      runtimeMode: input.runtimeMode,
      permissions: input.permissions,
    });

    if (!approval) {
      return { description: action, approval: null };
    }

    if (seenApprovalTypes.has(approval.action_type)) {
      return { description: action, approval: null };
    }
    seenApprovalTypes.add(approval.action_type);

    return {
      description: action,
      approval,
    };
  });
}
