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
      `has been created. Our AI agents are already working on your Phase&nbsp;0 pitch packet.`,
    ),
    paragraph("Here's what happens next:"),
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 8px">
      ${stepRow("1", "Research agents scan your market, competitors, and positioning.")}
      ${stepRow("2", "A pitch packet lands in your Inbox with a confidence score and CEO recommendation.")}
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
}) {
  const recLabel = input.recommendation.charAt(0).toUpperCase() + input.recommendation.slice(1);
  const recColor = input.recommendation === "greenlight" ? "#22C55E" : input.recommendation === "revise" ? "#F59E0B" : "#EF4444";
  const subject = `Phase 0 report ready — ${input.projectName}`;
  const body = [
    heading("Your pitch packet is ready"),
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
    paragraph("Open the report to review market sizing, competitor analysis, target persona, and the full CEO recommendation."),
    btn("Review your report", `${input.baseUrl}/projects/${input.projectId}/packet`),
  ].join("");

  return { subject, html: wrap(subject, `Confidence ${input.confidence}/100 — ${recLabel}`, body) };
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
// Nudge: no packet reviews
// ---------------------------------------------------------------------------

export function nudgeNoReviewsEmail(input: {
  pendingCount: number;
  oldestProjectName: string;
  baseUrl: string;
}) {
  const subject = "Your pitch packets are waiting for review";
  const body = [
    heading("Packets ready for your eyes"),
    paragraph(
      `You have <strong style="color:#F59E0B">${input.pendingCount} packet${input.pendingCount === 1 ? "" : "s"}</strong> ` +
      `waiting in your Inbox — starting with <strong style="color:#F1F5F9">${esc(input.oldestProjectName)}</strong>.`,
    ),
    paragraph(
      "Each packet contains market research, competitor analysis, and a CEO recommendation. " +
      "Review and approve to advance your project to the next phase.",
    ),
    btn("Review packets", `${input.baseUrl}/inbox`),
  ].join("");

  return { subject, html: wrap(subject, `${input.pendingCount} packets need your review`, body) };
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
