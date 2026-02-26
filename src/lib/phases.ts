export type PhaseId = 0 | 1 | 2 | 3;

export type PhaseDefinition = {
  id: PhaseId;
  label: string;
  title: string;
  summary: string;
  deliverables: string[];
  gateActionType: string;
};

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
