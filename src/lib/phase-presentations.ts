import PptxGenJS from "pptxgenjs";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { packetSchema } from "@/types/domain";
import { parsePhasePacket } from "@/types/phase-packets";

type PresentationInput = {
  projectId: string;
  phase: number;
  projectName: string;
  domain: string | null;
  packet: unknown;
  summary: string;
  ownerClerkId?: string | null;
};

type PresentationAssetResult = {
  htmlAssetId: string | null;
  pptxAssetId: string | null;
  htmlPreviewUrl: string | null;
  pptxPreviewUrl: string | null;
  highlights: string[];
};

function esc(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, unknown>;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function asStringArray(value: unknown, max = 8) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((entry) => asString(entry))
    .filter((entry) => entry.length > 0)
    .slice(0, max);
}

function phaseLabel(phase: number) {
  if (phase <= 0) return "Phase 0 · Pitch";
  if (phase === 1) return "Phase 1 · Validate";
  if (phase === 2) return "Phase 2 · Distribute";
  if (phase === 3) return "Phase 3 · Go Live";
  return `Phase ${phase}`;
}

export function derivePhaseHighlights(phase: number, packet: unknown, summary: string): string[] {
  const out: string[] = [];

  if (phase === 0) {
    const parsed = packetSchema.safeParse(packet);
    if (parsed.success) {
      out.push(`Recommendation: ${parsed.data.recommendation.toUpperCase()} (${parsed.data.reasoning_synopsis.confidence}/100)`);
      out.push(`Market: TAM ${parsed.data.market_sizing.tam} · SAM ${parsed.data.market_sizing.sam} · SOM ${parsed.data.market_sizing.som}`);
      out.push(`Persona: ${parsed.data.target_persona.name} — ${parsed.data.target_persona.description}`);
      const competitors = parsed.data.competitor_analysis.slice(0, 4).map((c) => c.name).join(", ");
      if (competitors) out.push(`Competitors: ${competitors}`);
      const nextActions = parsed.data.reasoning_synopsis.next_actions.slice(0, 3).join(" | ");
      if (nextActions) out.push(`CEO next actions: ${nextActions}`);
      return out;
    }
  }

  const record = asRecord(packet);
  if (phase === 1) {
    const landing = asRecord(record.landing_page);
    const brand = asRecord(record.brand_kit);
    const waitlist = asRecord(record.waitlist);
    out.push(`Landing: ${asString(landing.headline, "Landing headline pending")}`);
    out.push(`CTA: ${asString(landing.primary_cta, "Primary CTA pending")}`);
    out.push(`Brand voice: ${asString(brand.voice, "Voice pending")}`);
    out.push(`Target conversion: ${asString(waitlist.target_conversion_rate, "Not set")}`);
  } else if (phase === 2) {
    const strategy = asRecord(record.distribution_strategy);
    const paid = asRecord(record.paid_acquisition);
    const outreach = asRecord(record.outreach);
    out.push(`North star: ${asString(strategy.north_star_metric, "North star pending")}`);
    const channelPlan = Array.isArray(strategy.channel_plan)
      ? (strategy.channel_plan as Array<Record<string, unknown>>)
          .slice(0, 3)
          .map((row) => `${asString(row.channel, "Channel")}: ${asString(row.objective, "objective")}`)
      : [];
    if (channelPlan.length) out.push(`Channels: ${channelPlan.join(" | ")}`);
    out.push(`Paid budget/day: ${String(paid.budget_cap_per_day ?? 0)}`);
    out.push(`Outreach cap/day: ${String(outreach.daily_send_cap ?? 0)}`);
  } else if (phase === 3) {
    const arch = asRecord(record.architecture_review);
    const merge = asRecord(record.merge_policy);
    const checklist = asStringArray(record.launch_checklist, 3);
    out.push(`Runtime mode: ${asString(arch.runtime_mode, "shared")}`);
    out.push(`Protected branch: ${asString(merge.protected_branch, "main")}`);
    if (checklist.length) out.push(`Launch checklist: ${checklist.join(" | ")}`);
  }

  if (!out.length && summary.trim().length > 0) out.push(summary.trim());
  return out.slice(0, 6);
}

function renderPhasePacketHtml(input: {
  projectName: string;
  phase: number;
  domain: string | null;
  summary: string;
  highlights: string[];
  packet: unknown;
}) {
  const generatedAt = new Date().toISOString();
  const serializedPacket = JSON.stringify(input.packet, null, 2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(input.projectName)} ${esc(phaseLabel(input.phase))} Deck</title>
  <style>
    :root {
      --bg:#060b17;
      --surface:#0c1427;
      --surface2:#111b31;
      --text:#e6edf9;
      --muted:#8fa0bf;
      --accent:#22c55e;
      --border:rgba(143,160,191,.22);
    }
    * { box-sizing:border-box; }
    body {
      margin:0;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: radial-gradient(circle at 10% 0%, rgba(34,197,94,.15), transparent 35%), var(--bg);
      color:var(--text);
      line-height:1.5;
    }
    .deck {
      max-width: 1080px;
      margin: 0 auto;
      padding: 28px 18px 56px;
      display:grid;
      gap:14px;
    }
    .card {
      border:1px solid var(--border);
      background: linear-gradient(160deg, var(--surface), var(--surface2));
      border-radius: 14px;
      padding: 18px 20px;
    }
    .label {
      color:var(--accent);
      text-transform:uppercase;
      font-size:12px;
      letter-spacing:.08em;
      font-weight:700;
      margin-bottom:6px;
    }
    h1 {
      margin:0;
      font-size:34px;
      letter-spacing:-.02em;
      line-height:1.12;
    }
    .meta {
      color:var(--muted);
      margin-top:8px;
      font-size:13px;
    }
    .summary {
      margin:0;
      color:var(--text);
      font-size:16px;
    }
    ul {
      margin:8px 0 0;
      padding-left: 20px;
      display:grid;
      gap:8px;
    }
    li { color:var(--text); }
    pre {
      margin:0;
      white-space:pre-wrap;
      overflow-wrap:anywhere;
      font-size:12px;
      color:#bfd0ee;
      background:#060d1f;
      border:1px solid rgba(191,208,238,.18);
      border-radius:10px;
      padding:14px;
      max-height:520px;
      overflow:auto;
    }
  </style>
</head>
<body>
  <main class="deck">
    <section class="card">
      <div class="label">Startup Machine · ${esc(phaseLabel(input.phase))}</div>
      <h1>${esc(input.projectName)}</h1>
      <p class="meta">${esc(input.domain ?? "No domain")} · generated ${esc(new Date(generatedAt).toLocaleString())}</p>
    </section>

    <section class="card">
      <div class="label">Condensed Summary</div>
      <p class="summary">${esc(input.summary || "Summary pending.")}</p>
    </section>

    <section class="card">
      <div class="label">Highlights</div>
      <ul>
        ${(input.highlights.length ? input.highlights : ["No highlights available yet."]).map((item) => `<li>${esc(item)}</li>`).join("\n")}
      </ul>
    </section>

    <section class="card">
      <div class="label">Packet JSON</div>
      <pre>${esc(serializedPacket)}</pre>
    </section>
  </main>
</body>
</html>`;
}

async function renderPhasePacketPptx(input: {
  projectName: string;
  phase: number;
  domain: string | null;
  summary: string;
  highlights: string[];
}) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Startup Machine";
  pptx.company = "Startup Machine";
  pptx.subject = phaseLabel(input.phase);
  pptx.title = `${input.projectName} ${phaseLabel(input.phase)} Deck`;

  const cover = pptx.addSlide();
  cover.background = { color: "050B18" };
  cover.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
    fill: { color: "050B18" },
    line: { color: "050B18" },
  });
  cover.addText("Startup Machine", {
    x: 0.7,
    y: 0.5,
    w: 5.5,
    h: 0.4,
    color: "22C55E",
    fontSize: 16,
    bold: true,
  });
  cover.addText(input.projectName, {
    x: 0.7,
    y: 1.3,
    w: 11.6,
    h: 1.1,
    color: "E6EDF9",
    fontSize: 42,
    bold: true,
  });
  cover.addText(phaseLabel(input.phase), {
    x: 0.7,
    y: 2.55,
    w: 5,
    h: 0.6,
    color: "9FB1D3",
    fontSize: 20,
    bold: true,
  });
  cover.addText(`${input.domain ?? "No domain"} · ${new Date().toLocaleDateString()}`, {
    x: 0.7,
    y: 3.3,
    w: 8,
    h: 0.4,
    color: "8FA0BF",
    fontSize: 13,
  });

  const summarySlide = pptx.addSlide();
  summarySlide.background = { color: "0C1427" };
  summarySlide.addText("Condensed Summary", {
    x: 0.7,
    y: 0.6,
    w: 11,
    h: 0.5,
    color: "22C55E",
    fontSize: 20,
    bold: true,
  });
  summarySlide.addText(input.summary || "Summary pending.", {
    x: 0.7,
    y: 1.35,
    w: 11.8,
    h: 2.1,
    color: "E6EDF9",
    fontSize: 20,
    valign: "top",
  });

  const highlightsSlide = pptx.addSlide();
  highlightsSlide.background = { color: "101B31" };
  highlightsSlide.addText("Key Highlights", {
    x: 0.7,
    y: 0.6,
    w: 11,
    h: 0.5,
    color: "22C55E",
    fontSize: 20,
    bold: true,
  });
  const bullets = (input.highlights.length ? input.highlights : ["No highlights available yet."]).map((item) => ({
    text: item,
    options: { bullet: { indent: 12 }, breakLine: true },
  }));
  highlightsSlide.addText(bullets as Parameters<typeof highlightsSlide.addText>[0], {
    x: 0.95,
    y: 1.4,
    w: 11.5,
    h: 5.2,
    color: "D7E2F6",
    fontSize: 18,
    lineSpacingMultiple: 1.18,
  });

  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}

export async function createPhasePacketPresentationAssets(input: PresentationInput): Promise<PresentationAssetResult> {
  const db = createServiceSupabase();
  const phase = Math.max(0, Math.min(3, Math.trunc(input.phase)));
  const highlights = derivePhaseHighlights(phase, input.packet, input.summary);
  const html = renderPhasePacketHtml({
    projectName: input.projectName,
    phase,
    domain: input.domain,
    summary: input.summary,
    highlights,
    packet: input.packet,
  });
  const pptxBuffer = await renderPhasePacketPptx({
    projectName: input.projectName,
    phase,
    domain: input.domain,
    summary: input.summary,
    highlights,
  });

  const htmlPath = `${input.projectId}/phase-${phase}/phase-${phase}-packet.html`;
  const pptxPath = `${input.projectId}/phase-${phase}/phase-${phase}-packet.pptx`;
  const createdBy = input.ownerClerkId ?? "system";

  await withRetry(() =>
    db.storage.from("project-assets").upload(htmlPath, new TextEncoder().encode(html), {
      contentType: "text/html; charset=utf-8",
      upsert: true,
    }),
  );
  await withRetry(() =>
    db.storage.from("project-assets").upload(pptxPath, pptxBuffer, {
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      upsert: true,
    }),
  );

  const [htmlAssetRes, pptxAssetRes] = await Promise.all([
    withRetry(() =>
      db
        .from("project_assets")
        .insert({
          project_id: input.projectId,
          phase,
          kind: "upload",
          storage_bucket: "project-assets",
          storage_path: htmlPath,
          filename: `phase-${phase}-packet.html`,
          mime_type: "text/html",
          size_bytes: Buffer.byteLength(html, "utf8"),
          status: "uploaded",
          metadata: {
            label: `Phase ${phase} Packet Deck (HTML)`,
            phase_packet_deck: true,
            phase_packet_embed: true,
            phase,
            auto_generated: true,
          },
          created_by: createdBy,
        })
        .select("id")
        .single(),
    ),
    withRetry(() =>
      db
        .from("project_assets")
        .insert({
          project_id: input.projectId,
          phase,
          kind: "upload",
          storage_bucket: "project-assets",
          storage_path: pptxPath,
          filename: `phase-${phase}-packet.pptx`,
          mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          size_bytes: pptxBuffer.length,
          status: "uploaded",
          metadata: {
            label: `Phase ${phase} Packet Deck (PPTX)`,
            phase_packet_deck: true,
            phase_packet_pptx: true,
            phase,
            auto_generated: true,
          },
          created_by: createdBy,
        })
        .select("id")
        .single(),
    ),
  ]);

  const htmlAssetId = (htmlAssetRes.data?.id as string | undefined) ?? null;
  const pptxAssetId = (pptxAssetRes.data?.id as string | undefined) ?? null;

  return {
    htmlAssetId,
    pptxAssetId,
    htmlPreviewUrl: htmlAssetId ? `/api/projects/${input.projectId}/assets/${htmlAssetId}/preview` : null,
    pptxPreviewUrl: pptxAssetId ? `/api/projects/${input.projectId}/assets/${pptxAssetId}/preview` : null,
    highlights,
  };
}

export function readPacketSummaryForPhase(phase: number, packet: unknown) {
  const record = asRecord(packet);
  if (phase === 0) {
    const parsed = packetSchema.safeParse(packet);
    if (parsed.success) {
      return `${parsed.data.tagline}. ${parsed.data.elevator_pitch}`.trim();
    }
  }
  return asString(record.summary, "Packet summary pending.");
}

export function parsePacketForPhase(phase: number, packet: unknown) {
  try {
    return parsePhasePacket(phase, packet);
  } catch {
    return packet;
  }
}
