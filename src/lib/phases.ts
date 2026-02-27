export type PhaseId = 0 | 1 | 2 | 3;

export type PhaseDefinition = {
  id: PhaseId;
  label: string;
  title: string;
  summary: string;
  deliverables: string[];
  gateActionType: string;
};

// ---------------------------------------------------------------------------
// Agent profiles — from 01-agent-embodiment-spec.md
// ---------------------------------------------------------------------------

export type AgentProfile = {
  key: string;
  name: string;
  color: string;
  icon: string;
  statusPhrase: string;
};

export const AGENT_PROFILES: Record<string, AgentProfile> = {
  ceo_agent: { key: "ceo_agent", name: "CEO Agent", color: "#22C55E", icon: "👔", statusPhrase: "Synthesizing insights…" },
  research_agent: { key: "research_agent", name: "Research", color: "#3B82F6", icon: "🔍", statusPhrase: "Scanning competitors…" },
  design_agent: { key: "design_agent", name: "Design", color: "#A855F7", icon: "🎨", statusPhrase: "Drafting layouts…" },
  brand_agent: { key: "brand_agent", name: "Brand", color: "#F59E0B", icon: "🎭", statusPhrase: "Crafting identity…" },
  finance_agent: { key: "finance_agent", name: "Finance", color: "#06B6D4", icon: "📊", statusPhrase: "Sizing the market…" },
  scanner: { key: "scanner", name: "Scanner", color: "#64748B", icon: "🔎", statusPhrase: "Checking domains…" },
  repo_analyst: { key: "repo_analyst", name: "Repo Analyst", color: "#EC4899", icon: "📦", statusPhrase: "Analyzing structure…" },
  engineering: { key: "engineering", name: "Engineering", color: "#F97316", icon: "⚙️", statusPhrase: "Deploying changes…" },
  night_shift: { key: "night_shift", name: "Night Shift", color: "#8B5CF6", icon: "🌙", statusPhrase: "Running overnight…" },
};

const FALLBACK_AGENT: AgentProfile = {
  key: "unknown", name: "Agent", color: "#94A3B8", icon: "🤖", statusPhrase: "Working…",
};

export function getAgentProfile(agentKey: string): AgentProfile {
  return AGENT_PROFILES[agentKey] ?? { ...FALLBACK_AGENT, key: agentKey, name: agentKey };
}

// ---------------------------------------------------------------------------
// Human-readable task descriptions
// ---------------------------------------------------------------------------

const TASK_LABELS: Record<string, string> = {
  phase0_init: "Initializing project",
  phase0_research: "Researching market & competitors",
  phase0_research_query: "Running research queries",
  phase0_packet: "Building pitch packet",
  phase0_failed: "Research failed",
  phase1_validate: "Generating validation assets",
  phase1_validate_review: "Reviewing validation assets",
  phase1_landing: "Building landing page",
  phase1_brand: "Creating brand kit",
  phase1_waitlist: "Setting up waitlist capture",
  phase2_distribute: "Planning distribution strategy",
  phase2_distribute_review: "Reviewing distribution plan",
  phase2_ads: "Preparing ad creatives",
  phase2_email: "Drafting email campaigns",
  phase3_golive: "Preparing for launch",
  phase3_golive_review: "Reviewing launch readiness",
  phase3_build: "Building product features",
  phase3_deploy: "Deploying to production",
  nightshift_summary: "Night Shift summary",
  nightshift_run: "Night Shift processing",
};

export function humanizeTaskDescription(description: string): string {
  if (TASK_LABELS[description]) return TASK_LABELS[description];
  return description
    .replace(/^phase\d+_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function taskOutputLink(description: string, projectId: string): { href: string; label: string } | null {
  if (description === "phase1_deploy_live" || description === "phase1_design_agent_html") {
    return { href: `/launch/${projectId}`, label: "View Landing Page" };
  }
  if (description === "phase0_complete" || description === "phase0_packet") {
    return { href: `/projects/${projectId}/packet`, label: "View Packet" };
  }
  if (description === "nightshift_summary") {
    return { href: `/projects/${projectId}/phases`, label: "View Phases" };
  }
  const phase = taskPhase(description);
  if (phase === null) return null;
  if (phase === 0) return { href: `/projects/${projectId}/packet`, label: "View Packet" };
  return { href: `/projects/${projectId}/phases/${phase}`, label: `View Phase ${phase}` };
}

export const PHASES: PhaseDefinition[] = [
  {
    id: 0,
    label: "Phase 0",
    title: "Pitch Packet",
    summary: "Research, market sizing, competitor analysis, and CEO recommendation.",
    deliverables: [
      "Competitor Analysis",
      "Market Sizing (TAM/SAM/SOM)",
      "Target Persona",
      "MVP Scope",
      "Confidence Score",
      "CEO Recommendation",
    ],
    gateActionType: "phase0_packet_review",
  },
  {
    id: 1,
    label: "Phase 1",
    title: "Validate",
    summary: "Validation assets: landing page, waitlist, analytics, brand kit, and onboarding sequences.",
    deliverables: [
      "Landing Page",
      "Waitlist Capture",
      "Analytics Wiring",
      "Brand Kit",
      "Welcome Sequence",
    ],
    gateActionType: "phase1_validate_review",
  },
  {
    id: 2,
    label: "Phase 2",
    title: "Distribute",
    summary: "Distribution and demand generation with budget guardrails and outreach controls.",
    deliverables: [
      "Distribution Strategy",
      "Email Campaigns",
      "Ads Readiness",
      "Channel Plan",
      "Budget Guardrails",
    ],
    gateActionType: "phase2_distribute_review",
  },
  {
    id: 3,
    label: "Phase 3",
    title: "Go Live",
    summary: "Launch readiness and production execution with merge/deploy approval controls.",
    deliverables: [
      "Architecture Review",
      "Build Iteration Tasks",
      "Go-live Readiness Report",
      "Rollback Plan",
      "Launch Gate",
    ],
    gateActionType: "phase3_golive_review",
  },
];

export function phaseStatus(projectPhase: number, phaseId: number) {
  if (projectPhase > phaseId) return "completed";
  if (projectPhase === phaseId) return "active";
  return "upcoming";
}

export function taskPhase(description: string): PhaseId | null {
  if (description.startsWith("phase0_")) return 0;
  if (description.startsWith("phase1_")) return 1;
  if (description.startsWith("phase2_")) return 2;
  if (description.startsWith("phase3_")) return 3;
  return null;
}
