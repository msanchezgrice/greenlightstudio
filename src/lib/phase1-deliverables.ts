import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { log_task } from "@/lib/supabase-mcp";
import { sendPhase1ReadyDrip } from "@/lib/drip-emails";
import { generatePhase1LandingHtml, verifyLandingDesign, type ToolTrace } from "@/lib/agent";
import { generateBrandImages, uploadBrandImages } from "@/lib/brand-generator";
import { renderBrandBriefHtml, generateBrandBriefPptx } from "@/lib/brand-presentation";
import type { Phase1Packet } from "@/types/phase-packets";

type ProjectInfo = {
  id: string;
  name: string;
  domain: string | null;
  owner_clerk_id?: string;
  idea_description: string;
};

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function generateBrandLogoSvg(name: string, palette: string[]): string {
  const primary = palette[0] ?? "#6EE7B7";
  const secondary = palette[1] ?? "#3B82F6";
  const initial = name.charAt(0).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${primary}"/>
      <stop offset="100%" stop-color="${secondary}"/>
    </linearGradient>
  </defs>
  <rect width="120" height="120" rx="24" fill="url(#bg)"/>
  <text x="60" y="60" text-anchor="middle" dominant-baseline="central" fill="#fff" font-family="system-ui,-apple-system,sans-serif" font-size="52" font-weight="700">${initial}</text>
</svg>`;
}

function generateWordmarkSvg(name: string, palette: string[]): string {
  const primary = palette[0] ?? "#6EE7B7";
  const width = Math.max(200, name.length * 28 + 40);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 60" width="${width}" height="60">
  <text x="20" y="42" fill="${primary}" font-family="system-ui,-apple-system,sans-serif" font-size="36" font-weight="700" letter-spacing="-1">${escapeHtml(name)}</text>
</svg>`;
}

function renderBrandKitHtml(project: ProjectInfo, packet: Phase1Packet): string {
  const h = escapeHtml;
  const kit = packet.brand_kit;
  const primary = kit.color_palette[0] ?? "#6EE7B7";
  const secondary = kit.color_palette[1] ?? "#3B82F6";
  const bg = kit.color_palette[2] ?? "#0A0F1C";
  const logoSvg = generateBrandLogoSvg(project.name, kit.color_palette);
  const logoDataUri = `data:image/svg+xml,${encodeURIComponent(logoSvg)}`;
  const wordmarkSvg = generateWordmarkSvg(project.name, kit.color_palette);
  const wordmarkDataUri = `data:image/svg+xml,${encodeURIComponent(wordmarkSvg)}`;

  const colorSwatches = kit.color_palette
    .map(
      (c, i) => `
      <div style="text-align:center">
        <div style="width:80px;height:80px;border-radius:12px;background:${h(c)};border:1px solid rgba(255,255,255,.12);margin:0 auto 8px"></div>
        <code style="font-size:12px;color:#94A3B8">${h(c)}</code>
        <div style="font-size:11px;color:#64748B;margin-top:2px">${i === 0 ? "Primary" : i === 1 ? "Secondary" : i === 2 ? "Background" : `Accent ${i}`}</div>
      </div>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${h(project.name)} — Brand Kit</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet"/>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'DM Sans',system-ui,sans-serif;background:${bg};color:#E2E8F0;line-height:1.6;-webkit-font-smoothing:antialiased}
    .wrap{max-width:800px;margin:0 auto;padding:48px 32px 80px}
    h1{font-family:'Space Grotesk',sans-serif;font-size:36px;font-weight:700;color:#F8FAFC;margin-bottom:8px}
    h2{font-family:'Space Grotesk',sans-serif;font-size:22px;font-weight:700;color:#F8FAFC;margin:48px 0 20px;padding-top:32px;border-top:1px solid rgba(255,255,255,.08)}
    h3{font-size:14px;font-weight:600;color:#94A3B8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px}
    .subtitle{font-size:15px;color:#94A3B8;margin-bottom:40px}
    .logo-grid{display:flex;gap:32px;flex-wrap:wrap;margin-bottom:16px}
    .logo-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:32px;text-align:center;flex:1;min-width:200px}
    .logo-card img{max-height:80px;margin-bottom:12px}
    .logo-card .label{font-size:13px;color:#94A3B8}
    .logo-dark .logo-card{background:#F8FAFC;border-color:#E2E8F0}
    .palette-row{display:flex;gap:20px;flex-wrap:wrap;margin-bottom:16px}
    .type-sample{padding:24px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;margin-bottom:12px}
    .type-sample .heading-demo{font-family:'Space Grotesk',sans-serif;font-size:28px;font-weight:700;color:#F8FAFC;margin-bottom:8px}
    .type-sample .body-demo{font-family:'DM Sans',sans-serif;font-size:15px;color:#94A3B8}
    .voice-card{padding:24px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;margin-bottom:12px}
    .voice-label{font-size:13px;color:${primary};font-weight:600;margin-bottom:8px}
    .voice-text{font-size:15px;color:#CBD5E1;line-height:1.7}
    .usage-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    .usage-do,.usage-dont{padding:20px;border-radius:12px}
    .usage-do{background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.15)}
    .usage-dont{background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.15)}
    .usage-do h4{color:#22C55E;font-size:13px;margin-bottom:8px}
    .usage-dont h4{color:#EF4444;font-size:13px;margin-bottom:8px}
    .usage-do li,.usage-dont li{font-size:13px;color:#94A3B8;margin-bottom:4px}
    ul{padding-left:18px}
    .footer{margin-top:64px;padding-top:24px;border-top:1px solid rgba(255,255,255,.08);font-size:12px;color:#64748B;text-align:center}
    @media print{body{background:#fff;color:#1e293b}h1,h2,.type-sample .heading-demo{color:#0f172a}.subtitle,.logo-card .label,.voice-text,.usage-do li,.usage-dont li{color:#475569}}
    @media(max-width:640px){.wrap{padding:32px 16px}.logo-grid{flex-direction:column}.usage-grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${h(project.name)} Brand Kit</h1>
    <p class="subtitle">Brand guidelines and visual identity system. Generated by Greenlight Studio.</p>

    <h2>Logo</h2>
    <h3>Primary Marks</h3>
    <div class="logo-grid">
      <div class="logo-card">
        <img src="${logoDataUri}" alt="Logo Mark"/>
        <div class="label">Logo Mark</div>
      </div>
      <div class="logo-card">
        <img src="${wordmarkDataUri}" alt="Wordmark"/>
        <div class="label">Wordmark</div>
      </div>
    </div>
    <h3>On Light Background</h3>
    <div class="logo-grid logo-dark">
      <div class="logo-card">
        <img src="${logoDataUri}" alt="Logo Mark on Light"/>
        <div class="label" style="color:#64748B">Logo Mark — Light</div>
      </div>
      <div class="logo-card">
        <img src="${wordmarkDataUri}" alt="Wordmark on Light"/>
        <div class="label" style="color:#64748B">Wordmark — Light</div>
      </div>
    </div>

    <h2>Color Palette</h2>
    <div class="palette-row">${colorSwatches}</div>

    <h2>Typography</h2>
    <h3>${h(kit.font_pairing)}</h3>
    <div class="type-sample">
      <div class="heading-demo">The quick brown fox jumps over the lazy dog</div>
      <div class="body-demo">Body text uses DM Sans for readability across all screen sizes. Headings use Space Grotesk for a modern, geometric feel that pairs well with the brand's technical identity.</div>
    </div>

    <h2>Voice &amp; Tone</h2>
    <div class="voice-card">
      <div class="voice-label">Brand Voice</div>
      <div class="voice-text">${h(kit.voice)}</div>
    </div>

    <h2>Logo Concept</h2>
    <div class="voice-card">
      <div class="voice-label">Design Direction</div>
      <div class="voice-text">${h(kit.logo_prompt)}</div>
    </div>

    <h2>Usage Guidelines</h2>
    <div class="usage-grid">
      <div class="usage-do">
        <h4>Do</h4>
        <ul>
          <li>Use the logo mark at minimum 32px</li>
          <li>Maintain clear space equal to the mark's height</li>
          <li>Use brand colors consistently across all touchpoints</li>
          <li>Pair Space Grotesk headings with DM Sans body text</li>
        </ul>
      </div>
      <div class="usage-dont">
        <h4>Don't</h4>
        <ul>
          <li>Stretch or distort the logo proportions</li>
          <li>Place the logo on busy backgrounds without contrast</li>
          <li>Use more than 2 brand colors in a single layout</li>
          <li>Substitute the specified typefaces</li>
        </ul>
      </div>
    </div>

    <p class="footer">
      ${h(project.name)} Brand Kit &middot; Generated ${new Date().toLocaleDateString()} &middot; Greenlight Studio
    </p>
  </div>
</body>
</html>`;
}

function renderProductionLandingHtml(project: ProjectInfo, packet: Phase1Packet): string {
  const h = escapeHtml;
  const kit = packet.brand_kit;
  const lp = packet.landing_page;
  const wl = packet.waitlist;
  const primary = kit.color_palette[0] ?? "#6EE7B7";
  const secondary = kit.color_palette[1] ?? "#3B82F6";
  const bg = kit.color_palette[2] ?? "#0A0F1C";
  const name = project.name;
  const domain = project.domain ?? name;
  const logoSvg = generateBrandLogoSvg(name, kit.color_palette);
  const logoDataUri = `data:image/svg+xml,${encodeURIComponent(logoSvg)}`;

  const sectionCards = lp.sections
    .map(
      (s, i) => `
    <div class="feature-card" style="animation-delay:${0.1 + i * 0.08}s">
      <div class="feature-icon">${["◆", "▲", "●", "■", "★", "◇"][i % 6]}</div>
      <p>${h(s)}</p>
    </div>`,
    )
    .join("");

  const formFields = wl.form_fields
    .map((f) => {
      const fieldName = f.toLowerCase().replace(/\s+/g, "_");
      const inputType = fieldName.includes("email") ? "email" : "text";
      return `<input type="${inputType}" name="${h(fieldName)}" placeholder="${h(f)}" required aria-label="${h(f)}" />`;
    })
    .join("\n            ");

  const emailCards = packet.email_sequence.emails
    .map(
      (e) => `
    <div class="email-card">
      <span class="email-day">${h(e.day)}</span>
      <strong>${h(e.subject)}</strong>
      <p>${h(e.goal)}</p>
    </div>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${h(lp.headline)} — ${h(name)}</title>
  <meta name="description" content="${h(lp.subheadline)}"/>
  <meta property="og:title" content="${h(lp.headline)}"/>
  <meta property="og:description" content="${h(lp.subheadline)}"/>
  <meta property="og:type" content="website"/>
  <meta property="og:url" content="https://${h(domain)}"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet"/>
  <style>
    :root {
      --primary: ${primary};
      --secondary: ${secondary};
      --bg: ${bg};
      --surface: color-mix(in srgb, ${bg} 85%, white 15%);
      --border: color-mix(in srgb, ${bg} 70%, white 30%);
      --text: #E2E8F0;
      --text-muted: #94A3B8;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body {
      font-family: 'DM Sans', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }

    /* Noise overlay */
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.03'/%3E%3C/svg%3E");
      pointer-events: none;
      z-index: 1;
    }

    nav {
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 32px;
      background: color-mix(in srgb, var(--bg) 80%, transparent);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
    }
    .nav-brand { display: flex; align-items: center; gap: 12px; text-decoration: none; }
    .nav-brand img { width: 36px; height: 36px; border-radius: 8px; }
    .nav-brand span { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 18px; color: var(--text); }
    nav a.nav-cta {
      padding: 10px 20px;
      background: var(--primary);
      color: var(--bg);
      border-radius: 8px;
      font-weight: 600;
      text-decoration: none;
      font-size: 14px;
      transition: opacity .2s;
    }
    nav a.nav-cta:hover { opacity: .85; }

    .hero {
      position: relative;
      z-index: 2;
      max-width: 900px;
      margin: 0 auto;
      padding: 100px 32px 80px;
      text-align: center;
    }
    .hero-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 500;
      background: color-mix(in srgb, var(--primary) 12%, transparent);
      color: var(--primary);
      border: 1px solid color-mix(in srgb, var(--primary) 25%, transparent);
      margin-bottom: 28px;
    }
    .hero h1 {
      font-family: 'Space Grotesk', sans-serif;
      font-size: clamp(36px, 6vw, 64px);
      font-weight: 700;
      line-height: 1.08;
      letter-spacing: -0.03em;
      color: #F8FAFC;
      margin-bottom: 20px;
    }
    .hero h1 em {
      font-style: normal;
      background: linear-gradient(135deg, var(--primary), var(--secondary));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .hero p {
      font-size: 18px;
      color: var(--text-muted);
      max-width: 600px;
      margin: 0 auto 36px;
    }

    /* Waitlist Form */
    .waitlist-form {
      display: flex;
      gap: 10px;
      max-width: 480px;
      margin: 0 auto;
      flex-wrap: wrap;
      justify-content: center;
    }
    .waitlist-form input {
      flex: 1 1 200px;
      padding: 14px 18px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text);
      font-size: 15px;
      font-family: inherit;
      outline: none;
      transition: border-color .2s;
    }
    .waitlist-form input:focus { border-color: var(--primary); }
    .waitlist-form input::placeholder { color: var(--text-muted); }
    .waitlist-form button {
      padding: 14px 28px;
      background: var(--primary);
      color: var(--bg);
      border: none;
      border-radius: 10px;
      font-weight: 700;
      font-size: 15px;
      cursor: pointer;
      font-family: inherit;
      transition: transform .15s, opacity .2s;
      white-space: nowrap;
    }
    .waitlist-form button:hover { opacity: .9; transform: translateY(-1px); }
    .form-note { text-align: center; margin-top: 12px; font-size: 13px; color: var(--text-muted); }
    .form-success { display: none; text-align: center; padding: 20px; color: var(--primary); font-weight: 600; font-size: 18px; }

    /* Features */
    .features {
      position: relative;
      z-index: 2;
      max-width: 1000px;
      margin: 0 auto;
      padding: 40px 32px 80px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
    }
    .feature-card {
      padding: 28px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      transition: border-color .3s, transform .3s;
      animation: fadeUp .5s ease both;
    }
    .feature-card:hover {
      border-color: var(--primary);
      transform: translateY(-3px);
    }
    .feature-icon {
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 10px;
      background: color-mix(in srgb, var(--primary) 12%, transparent);
      color: var(--primary);
      font-size: 18px;
      margin-bottom: 16px;
    }
    .feature-card p {
      font-size: 15px;
      color: var(--text-muted);
      line-height: 1.5;
    }

    /* Social Proof / Notes */
    .notes-section {
      position: relative;
      z-index: 2;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 32px 60px;
    }
    .notes-section h2 {
      font-family: 'Space Grotesk', sans-serif;
      text-align: center;
      font-size: 28px;
      font-weight: 700;
      color: #F8FAFC;
      margin-bottom: 32px;
    }

    /* Email Sequence */
    .email-section {
      position: relative;
      z-index: 2;
      max-width: 700px;
      margin: 0 auto;
      padding: 0 32px 80px;
    }
    .email-section h2 {
      font-family: 'Space Grotesk', sans-serif;
      text-align: center;
      font-size: 24px;
      font-weight: 700;
      color: #F8FAFC;
      margin-bottom: 24px;
    }
    .email-card {
      padding: 20px 24px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      margin-bottom: 12px;
    }
    .email-day {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      background: color-mix(in srgb, var(--secondary) 15%, transparent);
      color: var(--secondary);
      margin-bottom: 8px;
    }
    .email-card strong { display: block; color: #F8FAFC; margin-bottom: 4px; }
    .email-card p { font-size: 14px; color: var(--text-muted); }

    /* CTA Bottom */
    .cta-bottom {
      position: relative;
      z-index: 2;
      text-align: center;
      padding: 60px 32px 100px;
    }
    .cta-bottom h2 {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 32px;
      font-weight: 700;
      color: #F8FAFC;
      margin-bottom: 16px;
    }
    .cta-bottom a {
      display: inline-block;
      padding: 16px 32px;
      background: var(--primary);
      color: var(--bg);
      border-radius: 10px;
      font-weight: 700;
      font-size: 16px;
      text-decoration: none;
      transition: transform .15s, opacity .2s;
    }
    .cta-bottom a:hover { opacity: .85; transform: translateY(-2px); }

    footer {
      position: relative;
      z-index: 2;
      text-align: center;
      padding: 32px;
      border-top: 1px solid var(--border);
      font-size: 13px;
      color: var(--text-muted);
    }
    footer a { color: var(--primary); text-decoration: none; }

    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(18px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @media (max-width: 640px) {
      nav { padding: 12px 16px; }
      .hero { padding: 60px 20px 48px; }
      .features { padding: 20px 16px 60px; }
      .waitlist-form { flex-direction: column; }
    }
  </style>
</head>
<body>
  <nav>
    <a href="#" class="nav-brand">
      <img src="${logoDataUri}" alt="${h(name)} logo"/>
      <span>${h(name)}</span>
    </a>
    <a href="#waitlist" class="nav-cta">${h(lp.primary_cta)}</a>
  </nav>

  <section class="hero">
    <div class="hero-badge">✦ Now in early access</div>
    <h1>${h(lp.headline).replace(/—/g, '— <em>').replace(/$/, '</em>')}</h1>
    <p>${h(lp.subheadline)}</p>

    <div id="waitlist">
      <form class="waitlist-form" id="waitlistForm" action="/api/waitlist" method="POST">
        <input type="hidden" name="project_id" value="${h(project.id)}"/>
        <input type="hidden" name="source" value="landing_page"/>
        ${formFields}
        <button type="submit">${h(lp.primary_cta)}</button>
      </form>
      <p class="form-note">Join the waitlist — no credit card required.</p>
      <div class="form-success" id="formSuccess">
        ✓ You're on the list! We'll be in touch soon.
      </div>
    </div>
  </section>

  <section class="features">
    ${sectionCards}
  </section>

  <section class="email-section">
    <h2>What happens after you sign up</h2>
    ${emailCards}
  </section>

  <section class="cta-bottom">
    <h2>Ready to get started?</h2>
    <a href="#waitlist">${h(lp.primary_cta)}</a>
  </section>

  <footer>
    <p>Built with <a href="https://greenlightstudio.dev">Greenlight Studio</a> · ${h(name)}</p>
  </footer>

  <script>
    document.getElementById('waitlistForm')?.addEventListener('submit', async function(e) {
      e.preventDefault();
      const form = e.target;
      const data = Object.fromEntries(new FormData(form));
      try {
        const res = await fetch(form.action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (res.ok) {
          form.style.display = 'none';
          document.querySelector('.form-note').style.display = 'none';
          document.getElementById('formSuccess').style.display = 'block';
        }
      } catch {}
    });
  </script>
</body>
</html>`;
}

export async function generatePhase1Deliverables(
  project: ProjectInfo,
  packet: Phase1Packet,
  appBaseUrl?: string,
): Promise<{ landingUrl: string | null; assetIds: string[] }> {
  const db = createServiceSupabase();
  const assetIds: string[] = [];
  let landingUrl: string | null = null;

  const landingTrack = async () => {
    await log_task(project.id, "design_agent", "phase1_landing_deploy", "running", "Agent designing production landing page (frontend-design skill)");

    const landingInput = {
      project_name: project.name,
      domain: project.domain,
      idea_description: project.idea_description,
      brand_kit: packet.brand_kit,
      landing_page: packet.landing_page,
      waitlist_fields: packet.waitlist.form_fields,
      project_id: project.id,
    };

    let html: string;
    let traces: ToolTrace[] = [];
    try {
      const agentResult = await generatePhase1LandingHtml(landingInput);
      html = agentResult.html;
      traces = agentResult.traces;

      const review = await verifyLandingDesign(html, packet.brand_kit);
      await log_task(project.id, "design_agent", "phase1_landing_review", "completed", `Design score: ${review.score}/100 — ${review.feedback.slice(0, 200)}`).catch(() => {});

      if (!review.pass) {
        await log_task(project.id, "design_agent", "phase1_landing_regen", "running", `Score ${review.score} below threshold, regenerating with feedback`);
        const retry = await generatePhase1LandingHtml(landingInput);
        html = retry.html;
        traces = [...traces, ...retry.traces];
      }
    } catch (agentError) {
      const msg = agentError instanceof Error ? agentError.message : "Agent landing page generation failed";
      await log_task(project.id, "design_agent", "phase1_landing_agent_fallback", "running", `Agent failed (${msg}), using template fallback`);
      html = renderProductionLandingHtml(project, packet);
    }

    if (traces.length > 0) {
      const traceLog = traces.map((t) => `${t.tool}(${t.input_preview.slice(0, 80)})`).join(" → ");
      await log_task(project.id, "design_agent", "phase1_landing_traces", "completed", `Tool trace: ${traceLog.slice(0, 300)}`).catch(() => {});
    }

    const deploymentPath = `${project.id}/deployments/landing-${Date.now()}.html`;

    const upload = await withRetry(() =>
      db.storage.from("project-assets").upload(deploymentPath, new TextEncoder().encode(html), {
        contentType: "text/html; charset=utf-8",
        upsert: true,
      }),
    );
    if (upload.error) throw new Error(upload.error.message);

    const { data: asset } = await withRetry(() =>
      db
        .from("project_assets")
        .insert({
          project_id: project.id,
          phase: 1,
          kind: "landing_html",
          storage_bucket: "project-assets",
          storage_path: deploymentPath,
          filename: "index.html",
          mime_type: "text/html",
          size_bytes: Buffer.byteLength(html, "utf8"),
          status: "uploaded",
          metadata: { auto_generated: true },
          created_by: project.owner_clerk_id ?? "system",
        })
        .select("id")
        .single(),
    );
    if (asset) assetIds.push(asset.id);

    const { data: publicUrlData } = db.storage.from("project-assets").getPublicUrl(deploymentPath);
    const storageUrl = publicUrlData?.publicUrl;
    const baseUrl = appBaseUrl ?? process.env.NEXT_PUBLIC_APP_URL;
    landingUrl = storageUrl || (baseUrl ? `${baseUrl}/launch/${project.id}` : `/launch/${project.id}`);

    await Promise.all([
      withRetry(() =>
        db.from("project_deployments").upsert(
          {
            project_id: project.id,
            phase: 1,
            status: "ready",
            html_content: html,
            metadata: { asset_id: asset?.id, storage_path: deploymentPath, auto_generated: true },
            deployed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "project_id" },
        ),
      ),
      withRetry(() =>
        db
          .from("projects")
          .update({ deploy_status: "ready", live_url: landingUrl, updated_at: new Date().toISOString() })
          .eq("id", project.id),
      ),
    ]);

    await log_task(project.id, "design_agent", "phase1_landing_deploy", "completed", landingUrl ?? "Landing page deployed");
  };

  const brandTrack = async () => {
    await log_task(project.id, "brand_agent", "phase1_brand_assets", "running", "Generating AI brand images + presentations");

    const brandImages = await generateBrandImages(project.id, project.name, packet.brand_kit);
    const imageAssetIds = await uploadBrandImages(project.id, brandImages, project.owner_clerk_id);
    assetIds.push(...imageAssetIds);

    const baseUrl = appBaseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const imageUrls: Record<string, string> = {};
    for (const img of brandImages) {
      const key = img.filename.replace(/\.\w+$/, "");
      const { data: pub } = db.storage.from("project-assets").getPublicUrl(img.storagePath);
      imageUrls[key] = pub?.publicUrl ?? `${baseUrl}/api/projects/${project.id}/assets/preview?path=${encodeURIComponent(img.storagePath)}`;
    }

    const briefHtml = renderBrandBriefHtml(project, packet, imageUrls);
    const briefHtmlPath = `${project.id}/brand/brand-brief.html`;
    await withRetry(() =>
      db.storage.from("project-assets").upload(briefHtmlPath, new TextEncoder().encode(briefHtml), {
        contentType: "text/html; charset=utf-8",
        upsert: true,
      }),
    );
    const { data: briefHtmlAsset } = await withRetry(() =>
      db
        .from("project_assets")
        .insert({
          project_id: project.id,
          phase: 1,
          kind: "upload",
          storage_bucket: "project-assets",
          storage_path: briefHtmlPath,
          filename: "brand-brief.html",
          mime_type: "text/html",
          size_bytes: Buffer.byteLength(briefHtml, "utf8"),
          status: "uploaded",
          metadata: { label: "Brand Brief (Presentation)", auto_generated: true, brand_brief: true },
          created_by: project.owner_clerk_id ?? "system",
        })
        .select("id")
        .single(),
    );
    if (briefHtmlAsset) assetIds.push(briefHtmlAsset.id);

    await log_task(project.id, "brand_agent", "phase1_brand_pptx", "running", "Generating PowerPoint brand brief");
    const pptxBuffer = await generateBrandBriefPptx(project, packet, brandImages);
    const pptxPath = `${project.id}/brand/brand-brief.pptx`;
    await withRetry(() =>
      db.storage.from("project-assets").upload(pptxPath, pptxBuffer, {
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        upsert: true,
      }),
    );
    const { data: pptxAsset } = await withRetry(() =>
      db
        .from("project_assets")
        .insert({
          project_id: project.id,
          phase: 1,
          kind: "upload",
          storage_bucket: "project-assets",
          storage_path: pptxPath,
          filename: "brand-brief.pptx",
          mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          size_bytes: pptxBuffer.length,
          status: "uploaded",
          metadata: { label: "Brand Brief (PowerPoint)", auto_generated: true, brand_brief_pptx: true },
          created_by: project.owner_clerk_id ?? "system",
        })
        .select("id")
        .single(),
    );
    if (pptxAsset) assetIds.push(pptxAsset.id);

    const totalAssets = brandImages.length + 2;
    await log_task(project.id, "brand_agent", "phase1_brand_assets", "completed", `Generated ${totalAssets} brand assets (${brandImages.length} images + HTML brief + PPTX)`);
  };

  const results = await Promise.allSettled([landingTrack(), brandTrack()]);
  for (const result of results) {
    if (result.status === "rejected") {
      const msg = result.reason instanceof Error ? result.reason.message : "Deliverable generation failed";
      await log_task(project.id, "ceo_agent", "phase1_complete", "failed", msg).catch(() => {});
    }
  }

  if (landingUrl) {
    await withRetry(() =>
      db
        .from("phase_packets")
        .update({
          deliverables: [
            { kind: "landing_html", label: "Landing Page", url: landingUrl, status: "deployed", generated_at: new Date().toISOString() },
            { kind: "brand_brief_html", label: "Brand Brief (Presentation)", status: "generated", generated_at: new Date().toISOString() },
            { kind: "brand_brief_pptx", label: "Brand Brief (PowerPoint)", status: "generated", generated_at: new Date().toISOString() },
            { kind: "brand_logo", label: "AI Logo", status: "generated", generated_at: new Date().toISOString() },
            { kind: "brand_hero", label: "Hero Image", status: "generated", generated_at: new Date().toISOString() },
            { kind: "brand_assets", label: "Brand Kit Document", status: "generated", generated_at: new Date().toISOString() },
          ],
        })
        .eq("project_id", project.id)
        .eq("phase", 1),
    ).catch(() => {});
  }

  if (project.owner_clerk_id) {
    try {
      const { data: userRow } = await db
        .from("users")
        .select("id,email")
        .eq("clerk_id", project.owner_clerk_id)
        .maybeSingle();
      if (userRow?.email) {
        await sendPhase1ReadyDrip({
          userId: userRow.id as string,
          email: userRow.email as string,
          projectId: project.id,
          projectName: project.name,
          landingUrl,
        });
      }
    } catch {
      // non-fatal
    }
  }

  return { landingUrl, assetIds };
}
