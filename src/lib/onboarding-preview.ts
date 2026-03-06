import type { ScanResult } from "@/types/domain";

export type PreviewRecommendation = "greenlight" | "revise" | "research";

export type PreviewBrief = {
  title: string;
  recommendation: PreviewRecommendation;
  confidence: number;
  confidenceLabel: string;
  summary: string;
  keyRisk: string;
  topOpportunity: string;
  nextStep: string;
  evidenceLabel: string;
  competitorSnapshot: Array<{
    name: string;
    snippet: string;
    url?: string;
  }>;
  signals: Array<{
    label: string;
    value: string;
    tone: "positive" | "caution" | "neutral";
  }>;
};

type PreviewInput = {
  primaryDomain: string;
  additionalDomains: string[];
  ideaDescription: string;
  appDescription: string;
  valueProp: string;
  mission: string;
  targetDemo: string;
  repoUrl: string;
  scanResults: ScanResult | null;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function daysSinceIso(date: string | null | undefined) {
  if (!date) return null;
  const parsed = Date.parse(date);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor((Date.now() - parsed) / 86_400_000);
}

function confidenceLabel(confidence: number) {
  if (confidence >= 78) return "Strong early signal";
  if (confidence >= 62) return "Promising with gaps";
  return "Needs sharper positioning";
}

function recommendationForConfidence(confidence: number): PreviewRecommendation {
  if (confidence >= 78) return "greenlight";
  if (confidence >= 62) return "revise";
  return "research";
}

function recommendationHeadline(recommendation: PreviewRecommendation) {
  if (recommendation === "greenlight") return "Worth a full Phase 0 brief";
  if (recommendation === "revise") return "Promising, but refine the story";
  return "Gather more signal before committing";
}

function buildSummary(input: PreviewInput, recommendation: PreviewRecommendation) {
  const hasRepo = Boolean(input.repoUrl.trim());
  const hasLiveDomain = input.scanResults?.dns === "live";
  const hasCompetitors = (input.scanResults?.competitors_found.length ?? 0) > 0;

  if (recommendation === "greenlight") {
    if (hasLiveDomain) {
      return "There is enough real-world signal to justify a full founder brief and decision deck now.";
    }
    if (hasRepo) {
      return "The repo provides enough implementation signal to turn this into a credible Phase 0 recommendation quickly.";
    }
    return "The idea already has enough shape to justify a proper market and positioning brief.";
  }

  if (recommendation === "revise") {
    if (hasCompetitors) {
      return "The concept is viable, but the positioning needs to get sharper before this becomes a clear yes.";
    }
    return "There is something here, but the brief will be stronger once the audience and promise are more explicit.";
  }

  return "Right now the idea is still too thin or too unproven to trust a go/no-go call without more evidence.";
}

function buildKeyRisk(input: PreviewInput) {
  const scan = input.scanResults;
  const repoAgeDays = daysSinceIso(scan?.repo_summary?.last_commit ?? null);
  const competitorCount = scan?.competitors_found.length ?? 0;
  const hasAudience = input.targetDemo.trim().length >= 20;
  const hasValueProp = input.valueProp.trim().length >= 20;

  if (!hasAudience) {
    return "The target customer is still underspecified, which makes pricing, channel choice, and messaging guesswork.";
  }
  if (!hasValueProp) {
    return "The value proposition is not sharp enough yet, so the brief may default to generic positioning.";
  }
  if (scan?.dns === "parked") {
    return "The domain exists, but the parked state adds almost no usable market or product signal.";
  }
  if (competitorCount >= 5) {
    return "The category already looks crowded, so differentiation will need to be explicit in the first brief.";
  }
  if (repoAgeDays !== null && repoAgeDays > 365) {
    return "The repository appears stale, which may mean the product assumptions or architecture are outdated.";
  }
  if (!input.primaryDomain && !input.repoUrl.trim() && input.ideaDescription.trim().length < 40) {
    return "There is not enough evidence yet beyond the concept statement, so confidence should stay conservative.";
  }
  return "The first brief may still need a second pass once the team sharpens the ICP and launch angle.";
}

function buildOpportunity(input: PreviewInput) {
  const scan = input.scanResults;
  const repoFramework = scan?.repo_summary?.framework;
  const competitorCount = scan?.competitors_found.length ?? 0;

  if (scan?.dns === "live") {
    return "Existing site signal can accelerate positioning, teardown analysis, and a stronger recommendation in Phase 0.";
  }
  if (repoFramework) {
    return `The existing ${repoFramework} codebase should make the MVP path more concrete than a pure idea-stage project.`;
  }
  if (competitorCount === 0 && input.ideaDescription.trim().length >= 20) {
    return "A sparse competitor set may indicate a niche worth testing before larger players crowd it.";
  }
  if (input.valueProp.trim().length >= 20) {
    return "The current value proposition already hints at a hook that can be sharpened into a strong validation brief.";
  }
  return "A short founder brief now can expose whether the concept needs better positioning or just more evidence.";
}

function buildSignals(input: PreviewInput): PreviewBrief["signals"] {
  const scan = input.scanResults;
  const strategicFields =
    [input.appDescription, input.valueProp, input.mission, input.targetDemo].filter((value) => value.trim().length >= 20).length;
  const competitors = scan?.competitors_found.length ?? 0;

  return [
    {
      label: "Input path",
      value: input.primaryDomain
        ? `Domain${input.additionalDomains.length ? ` +${input.additionalDomains.length} more` : ""}`
        : input.repoUrl.trim()
          ? "Repository"
          : "Idea only",
      tone: input.primaryDomain || input.repoUrl.trim() ? "positive" : "neutral",
    },
    {
      label: "Discovery signal",
      value: scan?.dns === "live" ? "Live site found" : scan?.dns === "parked" ? "Parked domain" : scan ? "Partial scan" : "No scan yet",
      tone: scan?.dns === "live" ? "positive" : scan?.dns === "parked" ? "caution" : "neutral",
    },
    {
      label: "Competitive signal",
      value: competitors > 0 ? `${competitors} competitors surfaced` : "No competitors surfaced yet",
      tone: competitors > 0 ? "positive" : "neutral",
    },
    {
      label: "Strategy depth",
      value: strategicFields > 0 ? `${strategicFields}/4 context fields filled` : "No strategic context yet",
      tone: strategicFields >= 2 ? "positive" : strategicFields === 1 ? "neutral" : "caution",
    },
  ];
}

export function buildPreviewBrief(input: PreviewInput): PreviewBrief {
  const scan = input.scanResults;
  const signalCount =
    (scan?.dns === "live" ? 24 : scan?.dns === "parked" ? 8 : 0) +
    (scan?.repo_summary && !scan.repo_summary.error ? 18 : 0) +
    Math.min(18, (scan?.competitors_found.length ?? 0) * 4) +
    (scan?.meta?.desc ? 8 : 0) +
    Math.min(24, [input.appDescription, input.valueProp, input.mission, input.targetDemo].filter((value) => value.trim().length >= 20).length * 6) +
    (input.ideaDescription.trim().length >= 20 ? 10 : 0);

  const confidence = clamp(36 + signalCount, 38, 92);
  const recommendation = recommendationForConfidence(confidence);
  const titleSeed =
    input.primaryDomain ||
    input.appDescription.trim() ||
    input.ideaDescription.trim() ||
    input.valueProp.trim() ||
    input.repoUrl.trim() ||
    "Your project";

  return {
    title: titleSeed.slice(0, 80),
    recommendation,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    summary: buildSummary(input, recommendation),
    keyRisk: buildKeyRisk(input),
    topOpportunity: buildOpportunity(input),
    nextStep:
      recommendation === "greenlight"
        ? "Launch the full Phase 0 brief and pressure-test the positioning against the surfaced competitors."
        : recommendation === "revise"
          ? "Tighten the ICP and value prop, then launch Phase 0 so the recommendation is based on sharper assumptions."
          : "Add a clearer audience, stronger problem statement, or a domain/repo before trusting a launch recommendation.",
    evidenceLabel:
      scan?.dns === "live" || (scan?.repo_summary && !scan.repo_summary.error)
        ? "High-evidence preview"
        : scan
          ? "Partial-evidence preview"
          : "Idea-stage preview",
    competitorSnapshot: (scan?.competitors_found ?? []).slice(0, 3).map((competitor) => ({
      name: competitor.name,
      snippet: competitor.snippet ?? "No description captured yet.",
      url: competitor.url,
    })),
    signals: buildSignals(input),
  };
}

export function previewRecommendationLabel(recommendation: PreviewRecommendation) {
  if (recommendation === "greenlight") return "Greenlight";
  if (recommendation === "revise") return "Revise";
  return "Research First";
}

export function previewRecommendationHeadline(recommendation: PreviewRecommendation) {
  return recommendationHeadline(recommendation);
}
