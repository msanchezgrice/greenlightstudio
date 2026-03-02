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

type SlideDescriptor = {
  title: string;
  subtitle?: string;
  metrics?: Array<{ label: string; value: string }>;
  bullets?: string[];
  paragraphs?: string[];
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

function chunk<T>(list: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
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
  return out.slice(0, 8);
}

function buildSlides(input: {
  phase: number;
  packet: unknown;
  projectName: string;
  domain: string | null;
  summary: string;
  highlights: string[];
}): SlideDescriptor[] {
  const slides: SlideDescriptor[] = [
    {
      title: `${input.projectName} · ${phaseLabel(input.phase)}`,
      subtitle: `${input.domain ?? "No domain"} · Generated ${new Date().toLocaleString()}`,
      metrics: [{ label: "Project", value: input.projectName }, { label: "Phase", value: `${input.phase}` }],
      paragraphs: [input.summary || "Summary pending."],
    },
  ];

  if (input.phase === 0) {
    const parsed = packetSchema.safeParse(input.packet);
    if (parsed.success) {
      const data = parsed.data;
      slides.push({
        title: "Recommendation",
        subtitle: `${data.recommendation.toUpperCase()} · Confidence ${data.reasoning_synopsis.confidence}/100`,
        paragraphs: [data.tagline, data.elevator_pitch],
        bullets: data.reasoning_synopsis.rationale.slice(0, 5),
      });
      slides.push({
        title: "Market Sizing",
        metrics: [
          { label: "TAM", value: data.market_sizing.tam },
          { label: "SAM", value: data.market_sizing.sam },
          { label: "SOM", value: data.market_sizing.som },
        ],
        paragraphs: [
          "Sizing assumptions and market framing should be validated with first-customer interviews and pricing tests.",
        ],
      });
      slides.push({
        title: "Competitor Snapshot",
        bullets: data.competitor_analysis
          .slice(0, 6)
          .map((entry) => `${entry.name}: ${entry.positioning} | Gap: ${entry.gap}`),
      });
      slides.push({
        title: "Target Persona + MVP Scope",
        paragraphs: [`${data.target_persona.name}: ${data.target_persona.description}`],
        bullets: [
          ...data.target_persona.pain_points.slice(0, 3).map((point) => `Pain: ${point}`),
          ...data.mvp_scope.in_scope.slice(0, 3).map((item) => `In scope: ${item}`),
          ...data.mvp_scope.deferred.slice(0, 2).map((item) => `Deferred: ${item}`),
        ],
      });
      slides.push({
        title: "Risks + Next Actions",
        bullets: [
          ...data.reasoning_synopsis.risks.slice(0, 4).map((risk) => `Risk: ${risk}`),
          ...data.reasoning_synopsis.next_actions.slice(0, 4).map((action) => `Action: ${action}`),
        ],
      });
      return slides;
    }
  }

  slides.push({
    title: "Executive Highlights",
    bullets: input.highlights,
  });
  const chunks = chunk(input.highlights, 3);
  for (let index = 0; index < chunks.length; index += 1) {
    slides.push({
      title: `Highlights ${index + 1}`,
      bullets: chunks[index],
      paragraphs: index === chunks.length - 1 ? [input.summary || "Summary pending."] : undefined,
    });
  }

  return slides;
}

function renderMetricCards(metrics: Array<{ label: string; value: string }> | undefined) {
  if (!metrics || !metrics.length) return "";
  return `<div class="metrics">${metrics
    .map(
      (metric) => `<div class="metric">
  <div class="metric-label">${esc(metric.label)}</div>
  <div class="metric-value">${esc(metric.value)}</div>
</div>`,
    )
    .join("\n")}</div>`;
}

function renderPhaseDeckHtml(input: {
  projectName: string;
  phase: number;
  domain: string | null;
  summary: string;
  highlights: string[];
  packet: unknown;
}) {
  const slides = buildSlides({
    phase: input.phase,
    packet: input.packet,
    projectName: input.projectName,
    domain: input.domain,
    summary: input.summary,
    highlights: input.highlights,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(input.projectName)} ${esc(phaseLabel(input.phase))} Pitch Deck</title>
  <style>
    :root {
      --bg:#050b18;
      --surface:#0d162c;
      --surface2:#121d35;
      --text:#e8eefc;
      --muted:#9aabd0;
      --accent:#22c55e;
      --accent2:#60a5fa;
      --border:rgba(154,171,208,.3);
    }
    * { box-sizing:border-box; }
    body {
      margin:0;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color:var(--text);
      background:
        radial-gradient(ellipse at 10% 0%, rgba(34,197,94,.18), transparent 40%),
        radial-gradient(ellipse at 85% 100%, rgba(96,165,250,.12), transparent 45%),
        var(--bg);
      min-height:100vh;
      overflow:hidden;
    }
    .deck-shell {
      width: 100%;
      height: 100vh;
      display:flex;
      flex-direction:column;
      padding: 16px;
      gap: 12px;
    }
    .deck-header {
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:12px;
      border:1px solid var(--border);
      background: linear-gradient(150deg, var(--surface), var(--surface2));
      border-radius: 12px;
      padding: 12px 14px;
    }
    .deck-title {
      font-size: 14px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: .07em;
      font-weight: 700;
    }
    .deck-controls {
      display:flex;
      align-items:center;
      gap:8px;
    }
    .deck-btn {
      border:1px solid var(--border);
      background:#091126;
      color:var(--text);
      border-radius:8px;
      font-size:12px;
      padding:7px 10px;
      cursor:pointer;
      font-weight:700;
    }
    .deck-count {
      font-size:12px;
      color:var(--muted);
      min-width:58px;
      text-align:center;
      font-weight:600;
    }
    .deck-viewport {
      flex:1;
      min-height:0;
      position:relative;
      overflow:hidden;
    }
    .slide {
      position:absolute;
      inset:0;
      border:1px solid var(--border);
      background: linear-gradient(160deg, var(--surface), var(--surface2));
      border-radius:16px;
      padding: 26px 28px;
      display:flex;
      flex-direction:column;
      gap:14px;
      opacity:0;
      transform: translateX(14px) scale(.985);
      pointer-events:none;
      transition: opacity .28s ease, transform .28s ease;
      overflow:auto;
    }
    .slide.active {
      opacity:1;
      transform: translateX(0) scale(1);
      pointer-events:auto;
    }
    .slide-title {
      margin:0;
      font-size:34px;
      line-height:1.12;
      letter-spacing:-.02em;
    }
    .slide-subtitle {
      margin:0;
      color:var(--muted);
      font-size:14px;
    }
    .metrics {
      display:grid;
      grid-template-columns: repeat(auto-fit, minmax(180px,1fr));
      gap:10px;
    }
    .metric {
      border:1px solid var(--border);
      background:#081127;
      border-radius:10px;
      padding:10px 12px;
    }
    .metric-label {
      font-size:10px;
      text-transform:uppercase;
      letter-spacing:.08em;
      color:var(--muted);
      margin-bottom:4px;
      font-weight:700;
    }
    .metric-value {
      font-size:14px;
      color:var(--text);
      font-weight:700;
      line-height:1.35;
    }
    .slide p {
      margin:0;
      color:var(--text);
      font-size:16px;
      line-height:1.5;
    }
    ul {
      margin:0;
      padding-left:20px;
      display:grid;
      gap:8px;
    }
    li {
      color:var(--text);
      font-size:15px;
      line-height:1.42;
    }
    .dot-nav {
      display:flex;
      align-items:center;
      justify-content:center;
      gap:6px;
      flex-wrap:wrap;
    }
    .dot {
      width:10px;
      height:10px;
      border-radius:50%;
      border:1px solid var(--border);
      background:transparent;
      cursor:pointer;
    }
    .dot.active {
      background:var(--accent);
      border-color:var(--accent);
      box-shadow: 0 0 0 3px rgba(34,197,94,.2);
    }
    @media (max-width: 900px) {
      .deck-shell { padding: 10px; }
      .slide { padding: 16px; border-radius: 12px; }
      .slide-title { font-size: 24px; }
      .slide p, li { font-size: 14px; }
    }
  </style>
</head>
<body>
  <main class="deck-shell">
    <header class="deck-header">
      <div class="deck-title">${esc(input.projectName)} · ${esc(phaseLabel(input.phase))} Pitch Deck</div>
      <div class="deck-controls">
        <button type="button" class="deck-btn" id="prev-btn">Prev</button>
        <div class="deck-count" id="deck-count">1 / ${slides.length}</div>
        <button type="button" class="deck-btn" id="next-btn">Next</button>
      </div>
    </header>
    <div class="deck-viewport">
      ${slides
        .map(
          (slide, index) => `<section class="slide${index === 0 ? " active" : ""}" data-slide="${index}">
        <h1 class="slide-title">${esc(slide.title)}</h1>
        ${slide.subtitle ? `<p class="slide-subtitle">${esc(slide.subtitle)}</p>` : ""}
        ${renderMetricCards(slide.metrics)}
        ${(slide.paragraphs ?? []).map((paragraph) => `<p>${esc(paragraph)}</p>`).join("\n")}
        ${slide.bullets && slide.bullets.length ? `<ul>${slide.bullets.map((item) => `<li>${esc(item)}</li>`).join("\n")}</ul>` : ""}
      </section>`,
        )
        .join("\n")}
    </div>
    <nav class="dot-nav" id="dot-nav">
      ${slides.map((_, index) => `<button class="dot${index === 0 ? " active" : ""}" data-dot="${index}" aria-label="Go to slide ${index + 1}"></button>`).join("\n")}
    </nav>
  </main>
  <script>
    (function () {
      const slides = Array.from(document.querySelectorAll('.slide'));
      const dots = Array.from(document.querySelectorAll('.dot'));
      const count = document.getElementById('deck-count');
      const prev = document.getElementById('prev-btn');
      const next = document.getElementById('next-btn');
      let index = 0;

      function show(nextIndex) {
        index = (nextIndex + slides.length) % slides.length;
        slides.forEach((slide, slideIndex) => slide.classList.toggle('active', slideIndex === index));
        dots.forEach((dot, dotIndex) => dot.classList.toggle('active', dotIndex === index));
        if (count) count.textContent = String(index + 1) + " / " + String(slides.length);
      }

      prev && prev.addEventListener('click', function () { show(index - 1); });
      next && next.addEventListener('click', function () { show(index + 1); });
      dots.forEach((dot) => {
        dot.addEventListener('click', function () {
          const target = Number(dot.getAttribute('data-dot') || 0);
          show(target);
        });
      });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowLeft') show(index - 1);
        if (event.key === 'ArrowRight') show(index + 1);
      });
    })();
  </script>
</body>
</html>`;
}

function addSlideFrame(slide: PptxGenJS.Slide, title: string, subtitle?: string) {
  slide.background = { color: "0B1221" };
  slide.addShape("rect", {
    x: 0.4,
    y: 0.35,
    w: 12.55,
    h: 6.8,
    line: { color: "2A3A5D", pt: 1 },
    fill: { color: "0F1931" },
  });
  slide.addText(title, {
    x: 0.9,
    y: 0.7,
    w: 10.8,
    h: 0.7,
    color: "EAF0FF",
    fontSize: 28,
    bold: true,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.9,
      y: 1.35,
      w: 10.8,
      h: 0.4,
      color: "9CB0D8",
      fontSize: 12,
      italic: true,
    });
  }
}

function addMetricBoxes(slide: PptxGenJS.Slide, metrics: Array<{ label: string; value: string }>, startY: number) {
  const width = 3.8;
  const gap = 0.3;
  metrics.slice(0, 3).forEach((metric, index) => {
    const x = 0.9 + index * (width + gap);
    slide.addShape("roundRect", {
      x,
      y: startY,
      w: width,
      h: 1.05,
      line: { color: "2E436C", pt: 1 },
      fill: { color: "0A1430" },
    });
    slide.addText(metric.label, {
      x: x + 0.18,
      y: startY + 0.13,
      w: width - 0.3,
      h: 0.2,
      color: "8CA2CF",
      fontSize: 10,
      bold: true,
    });
    slide.addText(metric.value, {
      x: x + 0.18,
      y: startY + 0.38,
      w: width - 0.3,
      h: 0.56,
      color: "EAF0FF",
      fontSize: 13,
      bold: true,
      valign: "top",
    });
  });
}

function toBulletRuns(items: string[]) {
  return items.map((item) => ({ text: item, options: { bullet: { indent: 10 }, breakLine: true } }));
}

async function renderPhasePitchDeckPptx(input: {
  projectName: string;
  phase: number;
  domain: string | null;
  summary: string;
  highlights: string[];
  packet: unknown;
}) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Startup Machine";
  pptx.company = "Startup Machine";
  pptx.subject = phaseLabel(input.phase);
  pptx.title = `${input.projectName} ${phaseLabel(input.phase)} Pitch Deck`;

  const cover = pptx.addSlide();
  cover.background = { color: "060C18" };
  cover.addShape("rect", {
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
    fill: { color: "060C18" },
    line: { color: "060C18" },
  });
  cover.addText("Startup Machine", {
    x: 0.8,
    y: 0.6,
    w: 4.8,
    h: 0.35,
    color: "22C55E",
    fontSize: 15,
    bold: true,
  });
  cover.addText(input.projectName, {
    x: 0.8,
    y: 1.35,
    w: 11.8,
    h: 1.1,
    color: "EAF0FF",
    fontSize: 40,
    bold: true,
  });
  cover.addText(`${phaseLabel(input.phase)} Pitch Deck`, {
    x: 0.8,
    y: 2.6,
    w: 8,
    h: 0.45,
    color: "9CB0D8",
    fontSize: 18,
    bold: true,
  });
  cover.addText(`${input.domain ?? "No domain"} · ${new Date().toLocaleDateString()}`, {
    x: 0.8,
    y: 3.2,
    w: 9,
    h: 0.3,
    color: "8CA2CF",
    fontSize: 12,
  });

  const slides = buildSlides({
    phase: input.phase,
    packet: input.packet,
    projectName: input.projectName,
    domain: input.domain,
    summary: input.summary,
    highlights: input.highlights,
  }).slice(1);

  for (const descriptor of slides) {
    const slide = pptx.addSlide();
    addSlideFrame(slide, descriptor.title, descriptor.subtitle);

    let cursorY = 1.9;
    if (descriptor.metrics && descriptor.metrics.length > 0) {
      addMetricBoxes(slide, descriptor.metrics, cursorY);
      cursorY += 1.3;
    }

    if (descriptor.paragraphs && descriptor.paragraphs.length > 0) {
      slide.addText(descriptor.paragraphs.join("\n\n"), {
        x: 0.95,
        y: cursorY,
        w: 11.9,
        h: 2,
        color: "E5ECFF",
        fontSize: 17,
        valign: "top",
      });
      cursorY += 2.1;
    }

    if (descriptor.bullets && descriptor.bullets.length > 0) {
      slide.addText(toBulletRuns(descriptor.bullets) as Parameters<typeof slide.addText>[0], {
        x: 1.05,
        y: cursorY,
        w: 11.7,
        h: 2.8,
        color: "D9E4FA",
        fontSize: 14,
        lineSpacingMultiple: 1.2,
      });
    }
  }

  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}

export async function createPhasePacketPresentationAssets(input: PresentationInput): Promise<PresentationAssetResult> {
  const db = createServiceSupabase();
  const phase = Math.max(0, Math.min(3, Math.trunc(input.phase)));
  const highlights = derivePhaseHighlights(phase, input.packet, input.summary);
  const html = renderPhaseDeckHtml({
    projectName: input.projectName,
    phase,
    domain: input.domain,
    summary: input.summary,
    highlights,
    packet: input.packet,
  });
  const pptxBuffer = await renderPhasePitchDeckPptx({
    projectName: input.projectName,
    phase,
    domain: input.domain,
    summary: input.summary,
    highlights,
    packet: input.packet,
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
        .upsert(
          {
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
              label: `Phase ${phase} Pitch Deck (HTML)`,
              phase_packet_deck: true,
              phase_packet_embed: true,
              phase,
              auto_generated: true,
            },
            created_by: createdBy,
          },
          { onConflict: "project_id,storage_path" },
        )
        .select("id")
        .single(),
    ),
    withRetry(() =>
      db
        .from("project_assets")
        .upsert(
          {
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
              label: `Phase ${phase} Pitch Deck (PPTX)`,
              phase_packet_deck: true,
              phase_packet_pptx: true,
              phase,
              auto_generated: true,
            },
            created_by: createdBy,
          },
          { onConflict: "project_id,storage_path" },
        )
        .select("id")
        .single(),
    ),
  ]);

  if (htmlAssetRes.error) {
    throw new Error(htmlAssetRes.error.message);
  }
  if (pptxAssetRes.error) {
    throw new Error(pptxAssetRes.error.message);
  }

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
  return asString(record.summary, "Pitch deck summary pending.");
}

export function parsePacketForPhase(phase: number, packet: unknown) {
  try {
    return parsePhasePacket(phase, packet);
  } catch {
    return packet;
  }
}
