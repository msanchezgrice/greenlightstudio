import { toAbsoluteAppUrl, type Phase0Summary } from "@/lib/phase0-summary";

type DigestProject = {
  name: string;
  projectId: string;
  phase: number;
  pendingApprovals: number;
  recentCompletedTasks: number;
  recentFailedTasks: number;
  latestConfidence: number | null;
};

function wrap(title: string, preheader: string, body: string) {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="dark"/>
  <meta name="supported-color-schemes" content="dark"/>
  <title>${esc(title)}</title>
  <!--[if mso]><style>table,td{font-family:Arial,sans-serif!important}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#070B14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <span style="display:none;max-height:0;overflow:hidden">${esc(preheader)}&#8199;&#65279;&#847; &#8199;&#65279;&#847;</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#070B14">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
        <tr><td style="padding:28px 32px 20px;text-align:center">
          <span style="font-size:20px;font-weight:700;color:#22C55E;letter-spacing:-0.3px">&#9679; Greenlight Studio</span>
        </td></tr>
        <tr><td style="background:#111827;border:1px solid #1F2937;border-radius:12px;padding:36px 32px">
          ${body}
        </td></tr>
        <tr><td style="padding:24px 32px;text-align:center;color:#475569;font-size:12px;line-height:1.6">
          Greenlight Studio &mdash; AI-powered startup validation<br/>
          <a href="{{unsubscribe}}" style="color:#475569;text-decoration:underline">Unsubscribe</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function esc(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function btn(label: string, href: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0">
  <tr><td style="background:#22C55E;border-radius:8px;padding:12px 28px">
    <a href="${esc(href)}" style="color:#070B14;font-size:14px;font-weight:700;text-decoration:none;display:inline-block">${esc(label)}</a>
  </td></tr>
</table>`;
}

function heading(text: string) {
  return `<h1 style="margin:0 0 12px;font-size:24px;font-weight:700;color:#F1F5F9;line-height:1.3">${esc(text)}</h1>`;
}

function paragraph(text: string) {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#94A3B8">${text}</p>`;
}

function divider() {
  return `<hr style="border:none;border-top:1px solid #1F2937;margin:24px 0"/>`;
}

// ---------------------------------------------------------------------------
// Welcome email
// ---------------------------------------------------------------------------

export function welcomeEmail(input: { projectName: string; baseUrl: string }) {
  const subject = "Welcome to Greenlight Studio";
  const body = [
    heading("Welcome aboard"),
    paragraph(
      `Your first project &mdash; <strong style="color:#F1F5F9">${esc(input.projectName)}</strong> &mdash; ` +
      `has been created. Our AI agents are already working on your Phase&nbsp;0 pitch deck.`,
    ),
    paragraph("Here's what happens next:"),
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 8px">
      ${stepRow("1", "Research agents scan your market, competitors, and positioning.")}
      ${stepRow("2", "A pitch deck lands in your Inbox with a confidence score and CEO recommendation.")}
      ${stepRow("3", "Review, approve or revise — then advance through Validate, Distribute, and Go-Live.")}
    </table>`,
    btn("Open your dashboard", `${input.baseUrl}/board`),
  ].join("");

  return { subject, html: wrap(subject, `Your project "${input.projectName}" is live`, body) };
}

function stepRow(num: string, text: string) {
  return `<tr>
    <td width="32" valign="top" style="padding:6px 0">
      <span style="display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;border-radius:50%;background:#22C55E22;color:#22C55E;font-size:12px;font-weight:700">${num}</span>
    </td>
    <td style="padding:6px 0 6px 10px;color:#CBD5E1;font-size:14px;line-height:1.5">${text}</td>
  </tr>`;
}

// ---------------------------------------------------------------------------
// Phase 0 report ready
// ---------------------------------------------------------------------------

export function phase0ReadyEmail(input: {
  projectName: string;
  confidence: number;
  recommendation: string;
  projectId: string;
  baseUrl: string;
  summary?: Phase0Summary | null;
}) {
  const recLabel = input.recommendation.charAt(0).toUpperCase() + input.recommendation.slice(1);
  const recColor = input.recommendation === "greenlight" ? "#22C55E" : input.recommendation === "revise" ? "#F59E0B" : "#EF4444";
  const subject = `Phase 0 report ready — ${input.projectName}`;

  const summary = input.summary;
  const assetLinks = summary?.assets
    .filter((asset) => asset.url)
    .filter((asset) =>
      asset.kind.startsWith("phase0_packet") ||
      asset.kind.startsWith("phase0_brand_brief") ||
      asset.kind === "phase0_tech_news",
    )
    .slice(0, 4)
    .map((asset) => {
      const href = toAbsoluteAppUrl(input.baseUrl, asset.url);
      if (!href) return "";
      return `<a href="${esc(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 14px;border-radius:8px;border:1px solid #1F2937;color:#CBD5E1;text-decoration:none;font-size:13px">${esc(asset.label)}</a>`;
    })
    .filter(Boolean)
    .join("");

  const brandBlock = summary?.branding
    ? `<div style="margin:18px 0 0;padding:16px;background:#0A0F1A;border:1px solid #1F2937;border-radius:10px">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#64748B;margin-bottom:8px">Brand direction</div>
        <div style="color:#F1F5F9;font-size:14px;font-weight:600;margin-bottom:6px">${esc(summary.branding.voice)}</div>
        <div style="color:#94A3B8;font-size:13px;line-height:1.55;margin-bottom:8px">Fonts: ${esc(summary.branding.font_pairing)}</div>
        <div style="margin-bottom:8px">
          ${summary.branding.color_palette
            .slice(0, 6)
            .map(
              (color) =>
                `<span style="display:inline-block;width:18px;height:18px;border-radius:6px;margin-right:6px;background:${esc(color)};border:1px solid rgba(255,255,255,.12)"></span>`,
            )
            .join("")}
        </div>
        <div style="color:#94A3B8;font-size:13px;line-height:1.55">${esc(summary.branding.logo_prompt)}</div>
      </div>`
    : "";

  const competitorRows = summary?.competitors?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:14px">
        ${summary.competitors
          .slice(0, 4)
          .map(
            (competitor) => `<tr>
              <td style="padding:10px 0;border-bottom:1px solid #1F2937">
                <a href="${esc(competitor.url)}" style="color:#F1F5F9;font-size:14px;font-weight:600;text-decoration:none">${esc(competitor.name)}</a>
                <div style="margin-top:4px;color:#94A3B8;font-size:13px;line-height:1.5">${esc(competitor.positioning)}</div>
                <div style="margin-top:2px;color:#64748B;font-size:12px;line-height:1.5">Gap: ${esc(competitor.gap)} &middot; Pricing: ${esc(competitor.pricing)}</div>
              </td>
            </tr>`,
          )
          .join("")}
      </table>`
    : "";

  const evidenceRows = summary?.evidence?.length
    ? `<div style="margin-top:14px">
        ${summary.evidence
          .slice(0, 3)
          .map(
            (item) =>
              `<div style="margin-bottom:10px;color:#94A3B8;font-size:13px;line-height:1.55">
                ${esc(item.claim)}<br/>
                <a href="${esc(item.url)}" style="color:#22C55E;text-decoration:none">${esc(item.source)}</a>
              </div>`,
          )
          .join("")}
      </div>`
    : "";

  const conclusionList = summary
    ? `<ul style="margin:0 0 14px;padding-left:18px;color:#CBD5E1;font-size:14px;line-height:1.55">
        <li style="margin:0 0 6px">Market: TAM ${esc(summary.market.tam)} &middot; SAM ${esc(summary.market.sam)} &middot; SOM ${esc(summary.market.som)}</li>
        <li style="margin:0 0 6px">Persona: ${esc(summary.persona.name)} &mdash; ${esc(summary.persona.description)}</li>
        ${summary.rationale.slice(0, 2).map((line) => `<li style="margin:0 0 6px">${esc(line)}</li>`).join("")}
      </ul>`
    : paragraph("Open the report to review market sizing, competitor analysis, target persona, and the full CEO recommendation.");

  const body = [
    heading("Your pitch deck is ready"),
    paragraph(
      `The research agents have finished analyzing <strong style="color:#F1F5F9">${esc(input.projectName)}</strong>. ` +
      `Your Phase&nbsp;0 report is waiting for review.`,
    ),
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px">
      <tr>
        <td width="50%" style="padding:12px;background:#0A0F1A;border:1px solid #1F2937;border-radius:8px">
          <span style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#64748B;margin-bottom:4px">Confidence</span>
          <span style="font-size:28px;font-weight:700;color:#F1F5F9">${input.confidence}<span style="font-size:14px;color:#64748B">/100</span></span>
        </td>
        <td width="12"></td>
        <td width="50%" style="padding:12px;background:#0A0F1A;border:1px solid #1F2937;border-radius:8px">
          <span style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#64748B;margin-bottom:4px">Recommendation</span>
          <span style="font-size:20px;font-weight:700;color:${recColor}">${esc(recLabel)}</span>
        </td>
      </tr>
    </table>`,
    conclusionList,
    brandBlock,
    summary?.competitors?.length ? `<h2 style="margin:22px 0 10px;font-size:16px;color:#F1F5F9">Competitor watchlist</h2>${competitorRows}` : "",
    summary?.evidence?.length ? `<h2 style="margin:22px 0 10px;font-size:16px;color:#F1F5F9">Source links</h2>${evidenceRows}` : "",
    assetLinks ? `<h2 style="margin:22px 0 10px;font-size:16px;color:#F1F5F9">Phase 0 assets</h2><div style="margin-bottom:4px">${assetLinks}</div>` : "",
    btn("Review your report", `${input.baseUrl}/projects/${input.projectId}/phases/0`),
  ].join("");

  return { subject, html: wrap(subject, `Confidence ${input.confidence}/100 — ${recLabel}`, body) };
}

// ---------------------------------------------------------------------------
// Phase 1 deliverables ready
// ---------------------------------------------------------------------------

export function phase1ReadyEmail(input: {
  projectName: string;
  projectId: string;
  landingUrl: string | null;
  baseUrl: string;
}) {
  const subject = `Phase 1 deliverables ready — ${input.projectName}`;
  const landingRow = input.landingUrl
    ? `<tr>
        <td width="50%" style="padding:12px;background:#0A0F1A;border:1px solid #1F2937;border-radius:8px">
          <span style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#64748B;margin-bottom:4px">Landing Page</span>
          <a href="${esc(input.landingUrl)}" style="color:#22C55E;font-size:14px;font-weight:600;text-decoration:none">Live &rarr;</a>
        </td>
        <td width="12"></td>
        <td width="50%" style="padding:12px;background:#0A0F1A;border:1px solid #1F2937;border-radius:8px">
          <span style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#64748B;margin-bottom:4px">Brand Kit</span>
          <span style="font-size:14px;font-weight:600;color:#F1F5F9">Generated</span>
        </td>
      </tr>`
    : "";

  const body = [
    heading("Your validation assets are ready"),
    paragraph(
      `The agents have finished building Phase&nbsp;1 deliverables for <strong style="color:#F1F5F9">${esc(input.projectName)}</strong>. ` +
      `Your landing page, brand kit, and email sequence are ready for review.`,
    ),
    landingRow ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px">${landingRow}</table>` : "",
    paragraph("Open the Phase 1 workspace to see all your generated assets and review the gate decision."),
    btn("View Phase 1 workspace", `${input.baseUrl}/projects/${input.projectId}/phases/1`),
  ].join("");

  return { subject, html: wrap(subject, `Landing page, brand kit & email sequence for ${input.projectName}`, body) };
}

// ---------------------------------------------------------------------------
// Daily project overview
// ---------------------------------------------------------------------------

export function dailyOverviewEmail(input: {
  projectName: string;
  projectId: string;
  baseUrl: string;
  summaryLines: string[];
  aiTasks: string[];
  userTasks: string[];
}) {
  const subject = `Daily overview — ${input.projectName}`;
  const summary = input.summaryLines.length
    ? input.summaryLines.map((line) => `<li style="margin:0 0 6px">${esc(line)}</li>`).join("")
    : `<li style="margin:0 0 6px">No major changes were detected today.</li>`;
  const aiTasks = input.aiTasks.length
    ? input.aiTasks.map((line) => `<li style="margin:0 0 6px">${esc(line)}</li>`).join("")
    : `<li style="margin:0 0 6px">Continue monitoring and executing approved tasks.</li>`;
  const userTasks = input.userTasks.length
    ? input.userTasks.map((line) => `<li style="margin:0 0 6px">${esc(line)}</li>`).join("")
    : `<li style="margin:0 0 6px">Review project status and confirm next priorities.</li>`;
  const projectHref = `${input.baseUrl}/projects/${input.projectId}/phases`;
  const inboxHref = `${input.baseUrl}/inbox?project=${input.projectId}`;

  const body = [
    heading("Today’s progress recap"),
    paragraph(`Here is what happened today on <strong style="color:#F1F5F9">${esc(input.projectName)}</strong>.`),
    `<ul style="margin:0 0 14px;padding-left:18px;color:#CBD5E1;font-size:14px;line-height:1.55">${summary}</ul>`,
    divider(),
    `<h2 style="margin:0 0 10px;font-size:16px;color:#F1F5F9">3 tasks for me (CEO agent) tomorrow</h2>`,
    `<ol style="margin:0 0 16px;padding-left:20px;color:#CBD5E1;font-size:14px;line-height:1.55">${aiTasks}</ol>`,
    `<h2 style="margin:0 0 10px;font-size:16px;color:#F1F5F9">3 tasks for you tomorrow</h2>`,
    `<ol style="margin:0 0 16px;padding-left:20px;color:#CBD5E1;font-size:14px;line-height:1.55">${userTasks}</ol>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:6px"><tr>
      <td>${btn("Open Phase Dashboard", projectHref)}</td>
      <td align="right">${btn("Review Inbox", inboxHref)}</td>
    </tr></table>`,
  ].join("");

  return { subject, html: wrap(subject, `Daily recap and next tasks for ${input.projectName}`, body) };
}

// ---------------------------------------------------------------------------
// Weekly digest
// ---------------------------------------------------------------------------

export function weeklyDigestEmail(input: {
  projects: DigestProject[];
  totalPending: number;
  baseUrl: string;
}) {
  const subject = "Your weekly brief — Greenlight Studio";
  const projectRows = input.projects
    .map((p) => {
      const phaseLabel = `Phase ${p.phase}`;
      const confLabel = p.latestConfidence !== null ? `${p.latestConfidence}/100` : "—";
      const pendingBadge = p.pendingApprovals > 0
        ? `<span style="display:inline-block;background:#F59E0B22;color:#F59E0B;font-size:11px;padding:2px 8px;border-radius:99px;margin-left:6px">${p.pendingApprovals} pending</span>`
        : "";
      return `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #1F2937">
          <a href="${esc(input.baseUrl)}/projects/${esc(p.projectId)}" style="color:#F1F5F9;font-size:14px;font-weight:600;text-decoration:none">${esc(p.name)}</a>${pendingBadge}
          <div style="margin-top:4px;font-size:12px;color:#64748B">
            ${esc(phaseLabel)} &middot; Confidence ${confLabel} &middot;
            <span style="color:#22C55E">${p.recentCompletedTasks} done</span>${p.recentFailedTasks > 0 ? ` &middot; <span style="color:#EF4444">${p.recentFailedTasks} failed</span>` : ""}
          </div>
        </td>
      </tr>`;
    })
    .join("");

  const body = [
    heading("Weekly brief"),
    paragraph(
      input.totalPending > 0
        ? `You have <strong style="color:#F59E0B">${input.totalPending} item${input.totalPending === 1 ? "" : "s"} pending review</strong> across your projects.`
        : "All caught up — no pending reviews this week.",
    ),
    divider(),
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%">${projectRows}</table>`,
    btn("Open dashboard", `${input.baseUrl}/board`),
  ].join("");

  return { subject, html: wrap(subject, `${input.totalPending} pending reviews this week`, body) };
}

// ---------------------------------------------------------------------------
// Nudge: no pitch deck reviews
// ---------------------------------------------------------------------------

export function nudgeNoReviewsEmail(input: {
  pendingCount: number;
  oldestProjectName: string;
  baseUrl: string;
}) {
  const subject = "Your pitch decks are waiting for review";
  const body = [
    heading("Pitch decks ready for your review"),
    paragraph(
      `You have <strong style="color:#F59E0B">${input.pendingCount} pitch deck${input.pendingCount === 1 ? "" : "s"}</strong> ` +
      `waiting in your Inbox — starting with <strong style="color:#F1F5F9">${esc(input.oldestProjectName)}</strong>.`,
    ),
    paragraph(
      "Each pitch deck contains market research, competitor analysis, and a CEO recommendation. " +
      "Review and approve to advance your project to the next phase.",
    ),
    btn("Review pitch decks", `${input.baseUrl}/inbox`),
  ].join("");

  return { subject, html: wrap(subject, `${input.pendingCount} pitch deck${input.pendingCount === 1 ? "" : "s"} need your review`, body) };
}

// ---------------------------------------------------------------------------
// Nudge: no phase signoffs
// ---------------------------------------------------------------------------

export function nudgeNoSignoffsEmail(input: {
  projectName: string;
  currentPhase: number;
  baseUrl: string;
}) {
  const subject = "Ready to advance? Your project is waiting";
  const body = [
    heading("Time to move forward"),
    paragraph(
      `<strong style="color:#F1F5F9">${esc(input.projectName)}</strong> is still on Phase&nbsp;${input.currentPhase}. ` +
      `Sign off on the current phase to unlock the next set of AI-generated deliverables.`,
    ),
    paragraph(
      "The agents have finished their work — they just need your approval to keep going. " +
      "Head to your Inbox to review and advance.",
    ),
    btn("Go to Inbox", `${input.baseUrl}/inbox`),
  ].join("");

  return { subject, html: wrap(subject, `${input.projectName} is ready for the next phase`, body) };
}
