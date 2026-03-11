import type { TechNewsInsight } from "@/lib/agent";
import type { Deliverable, Packet, ScanResult } from "@/types/domain";
import type { Phase1Packet } from "@/types/phase-packets";

export type Phase0Summary = {
  generated_at: string;
  recommendation: Packet["recommendation"];
  confidence: number;
  tagline: string;
  elevator_pitch: string;
  market: {
    tam: string;
    sam: string;
    som: string;
  };
  persona: {
    name: string;
    description: string;
  };
  rationale: string[];
  risks: string[];
  next_actions: string[];
  competitors: Array<{
    name: string;
    positioning: string;
    gap: string;
    pricing: string;
    url: string;
  }>;
  evidence: Array<{
    claim: string;
    source: string;
    url: string;
  }>;
  branding: {
    voice: string;
    color_palette: string[];
    font_pairing: string;
    logo_prompt: string;
  } | null;
  assets: Array<{
    kind: string;
    label: string;
    url: string | null;
  }>;
  tech_news: {
    summary: string;
    url: string | null;
  } | null;
};

function clampText(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function searchUrl(query: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function absolutizeSourceUrl(source: string) {
  const compact = source.trim();
  if (!compact) return searchUrl("startup market research");
  if (/^https?:\/\//i.test(compact)) return compact;
  const embedded = compact.match(/https?:\/\/[^\s)]+/i)?.[0];
  if (embedded) return embedded;
  return searchUrl(compact);
}

function normalizeComparableName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function resolveCompetitorUrl(name: string, scanResults?: ScanResult | null) {
  const fallback = searchUrl(name);
  const discovered = scanResults?.competitors_found ?? [];
  const target = normalizeComparableName(name);
  if (!target) return fallback;

  const match = discovered.find((entry) => {
    const candidate = normalizeComparableName(entry.name);
    return candidate === target || candidate.includes(target) || target.includes(candidate);
  });

  return match?.url ?? fallback;
}

function normalizeDeliverables(input: Array<Deliverable | Record<string, unknown>> | null | undefined) {
  return (input ?? [])
    .map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      const kind = typeof row.kind === "string" ? row.kind : "asset";
      const label = typeof row.label === "string" ? row.label : kind;
      const url = typeof row.url === "string" && row.url.trim().length > 0 ? row.url.trim() : null;
      return {
        kind,
        label: clampText(label, 80),
        url,
      };
    })
    .filter((entry) => entry.label.length > 0);
}

export function buildPhase0Summary(input: {
  packet: Packet;
  brandKit?: Phase1Packet["brand_kit"] | null;
  deliverables?: Array<Deliverable | Record<string, unknown>> | null;
  scanResults?: ScanResult | null;
  techNews?: TechNewsInsight | null;
}) {
  const deliverables = normalizeDeliverables(input.deliverables);
  const techNewsDeliverable =
    deliverables.find((entry) => entry.kind === "phase0_tech_news") ??
    deliverables.find((entry) => entry.label.toLowerCase().includes("tech"));

  return {
    generated_at: new Date().toISOString(),
    recommendation: input.packet.recommendation,
    confidence: input.packet.reasoning_synopsis.confidence,
    tagline: clampText(input.packet.tagline, 180),
    elevator_pitch: clampText(input.packet.elevator_pitch, 320),
    market: {
      tam: input.packet.market_sizing.tam,
      sam: input.packet.market_sizing.sam,
      som: input.packet.market_sizing.som,
    },
    persona: {
      name: input.packet.target_persona.name,
      description: clampText(input.packet.target_persona.description, 220),
    },
    rationale: input.packet.reasoning_synopsis.rationale.slice(0, 4).map((entry) => clampText(entry, 180)),
    risks: input.packet.reasoning_synopsis.risks.slice(0, 4).map((entry) => clampText(entry, 180)),
    next_actions: input.packet.reasoning_synopsis.next_actions.slice(0, 4).map((entry) => clampText(entry, 180)),
    competitors: input.packet.competitor_analysis.slice(0, 6).map((entry) => ({
      name: clampText(entry.name, 80),
      positioning: clampText(entry.positioning, 180),
      gap: clampText(entry.gap, 180),
      pricing: clampText(entry.pricing, 120),
      url: resolveCompetitorUrl(entry.name, input.scanResults),
    })),
    evidence: input.packet.reasoning_synopsis.evidence.slice(0, 5).map((entry) => ({
      claim: clampText(entry.claim, 220),
      source: clampText(entry.source, 140),
      url: absolutizeSourceUrl(entry.source),
    })),
    branding: input.brandKit
      ? {
          voice: clampText(input.brandKit.voice, 220),
          color_palette: input.brandKit.color_palette.slice(0, 6),
          font_pairing: clampText(input.brandKit.font_pairing, 120),
          logo_prompt: clampText(input.brandKit.logo_prompt, 240),
        }
      : null,
    assets: deliverables.slice(0, 14),
    tech_news: input.techNews
      ? {
          summary: clampText(input.techNews.summary, 260),
          url: techNewsDeliverable?.url ?? null,
        }
      : null,
  } satisfies Phase0Summary;
}

export function toAbsoluteAppUrl(baseUrl: string, url: string | null | undefined) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = url.startsWith("/") ? url : `/${url}`;
  return `${normalizedBase}${normalizedPath}`;
}
