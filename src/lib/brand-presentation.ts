import PptxGenJS from "pptxgenjs";
import type { BrandImage } from "@/lib/brand-generator";
import type { Phase1Packet } from "@/types/phase-packets";

type ProjectInfo = {
  id: string;
  name: string;
  domain: string | null;
  idea_description: string;
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function renderBrandBriefHtml(
  project: ProjectInfo,
  packet: Phase1Packet,
  imageUrls: Record<string, string>,
): string {
  const h = escapeHtml;
  const kit = packet.brand_kit;
  const primary = kit.color_palette[0] ?? "#6EE7B7";
  const secondary = kit.color_palette[1] ?? "#3B82F6";
  const bg = kit.color_palette[2] ?? "#0A0F1C";

  const colorSwatches = kit.color_palette
    .map(
      (c, i) => `
      <div class="swatch">
        <div class="swatch-color" style="background:${h(c)}"></div>
        <code>${h(c)}</code>
        <span>${i === 0 ? "Primary" : i === 1 ? "Secondary" : i === 2 ? "Background" : `Accent ${i}`}</span>
      </div>`,
    )
    .join("");

  const logoSrc = imageUrls.logo ?? "";
  const heroSrc = imageUrls.hero ?? "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${h(project.name)} — Brand Brief</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Manrope',system-ui,sans-serif;background:${bg};color:#E2E8F0;-webkit-font-smoothing:antialiased}
    .slide{min-height:100vh;display:flex;flex-direction:column;justify-content:center;padding:80px 64px;position:relative;overflow:hidden}
    .slide+.slide{border-top:1px solid rgba(255,255,255,.06)}
    h1{font-family:'Instrument Serif',serif;font-size:clamp(48px,8vw,80px);font-weight:400;color:#F8FAFC;line-height:1.05;letter-spacing:-0.02em}
    h2{font-family:'Instrument Serif',serif;font-size:36px;font-weight:400;color:#F8FAFC;margin-bottom:32px}
    h3{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:${primary};margin-bottom:16px}
    p{font-size:16px;line-height:1.7;color:#94A3B8;max-width:640px}
    .cover{background:linear-gradient(135deg,${bg},${primary}11)}
    .cover h1 em{font-style:normal;color:${primary}}
    .cover p{font-size:20px;margin-top:24px;color:#CBD5E1}
    .cover .tag{display:inline-block;padding:6px 16px;border-radius:999px;font-size:12px;font-weight:600;background:${primary}15;color:${primary};border:1px solid ${primary}30;margin-bottom:32px}
    .logo-showcase{display:flex;gap:40px;flex-wrap:wrap;margin-top:24px}
    .logo-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:48px;display:flex;align-items:center;justify-content:center;min-width:240px;flex:1}
    .logo-card img{max-height:120px;max-width:100%}
    .logo-card.on-light{background:#F8FAFC;border-color:#E2E8F0}
    .palette-row{display:flex;gap:24px;flex-wrap:wrap}
    .swatch{text-align:center}
    .swatch-color{width:96px;height:96px;border-radius:16px;border:1px solid rgba(255,255,255,.1);margin-bottom:10px}
    .swatch code{display:block;font-size:13px;color:#94A3B8}
    .swatch span{font-size:11px;color:#64748B;margin-top:2px;display:block}
    .type-demo{padding:40px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:16px;margin-top:16px}
    .type-demo .display{font-family:'Instrument Serif',serif;font-size:48px;color:#F8FAFC;margin-bottom:12px}
    .type-demo .body{font-family:'Manrope',sans-serif;font-size:16px;color:#94A3B8;line-height:1.7}
    .voice-card{padding:32px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:16px;margin-top:16px}
    .voice-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:${primary};margin-bottom:12px}
    .voice-text{font-size:17px;color:#CBD5E1;line-height:1.8}
    .hero-showcase{margin-top:24px;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.08)}
    .hero-showcase img{width:100%;display:block}
    .guidelines-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:16px}
    .guideline-card{padding:28px;border-radius:16px}
    .guideline-do{background:rgba(34,197,94,.05);border:1px solid rgba(34,197,94,.15)}
    .guideline-dont{background:rgba(239,68,68,.05);border:1px solid rgba(239,68,68,.15)}
    .guideline-card h4{font-size:13px;font-weight:700;margin-bottom:12px}
    .guideline-do h4{color:#22C55E}
    .guideline-dont h4{color:#EF4444}
    .guideline-card li{font-size:14px;color:#94A3B8;margin-bottom:6px;line-height:1.5}
    ul{padding-left:18px}
    .footer{text-align:center;padding:48px;font-size:12px;color:#475569;border-top:1px solid rgba(255,255,255,.04)}
    @media(max-width:768px){.slide{padding:48px 24px}.guidelines-grid{grid-template-columns:1fr}.logo-showcase{flex-direction:column}}
    @media print{body{background:#fff;color:#1e293b}h1,h2,.type-demo .display{color:#0f172a}p,.voice-text{color:#475569}}
  </style>
</head>
<body>
  <section class="slide cover">
    <div class="tag">Brand Brief</div>
    <h1><em>${h(project.name)}</em><br/>Brand Identity</h1>
    <p>${h(project.idea_description.slice(0, 200))}</p>
  </section>

  <section class="slide">
    <h3>Logo</h3>
    <h2>Brand Mark</h2>
    <p>${h(kit.logo_prompt)}</p>
    <div class="logo-showcase">
      ${logoSrc ? `<div class="logo-card"><img src="${h(logoSrc)}" alt="${h(project.name)} logo"/></div>` : ""}
      ${logoSrc ? `<div class="logo-card on-light"><img src="${h(logoSrc)}" alt="${h(project.name)} logo on light"/></div>` : ""}
    </div>
  </section>

  ${heroSrc ? `
  <section class="slide">
    <h3>Hero Imagery</h3>
    <h2>Visual Direction</h2>
    <div class="hero-showcase"><img src="${h(heroSrc)}" alt="Hero image"/></div>
  </section>` : ""}

  <section class="slide">
    <h3>Color</h3>
    <h2>Color Palette</h2>
    <div class="palette-row">${colorSwatches}</div>
  </section>

  <section class="slide">
    <h3>Typography</h3>
    <h2>${h(kit.font_pairing)}</h2>
    <div class="type-demo">
      <div class="display">The quick brown fox</div>
      <div class="body">Body text uses Manrope for readability across all screen sizes and devices. The pairing of a serif display with a geometric sans creates visual contrast that feels both editorial and modern.</div>
    </div>
  </section>

  <section class="slide">
    <h3>Voice & Tone</h3>
    <h2>How We Speak</h2>
    <div class="voice-card">
      <div class="voice-label">Brand Voice</div>
      <div class="voice-text">${h(kit.voice)}</div>
    </div>
  </section>

  <section class="slide">
    <h3>Usage</h3>
    <h2>Brand Guidelines</h2>
    <div class="guidelines-grid">
      <div class="guideline-card guideline-do">
        <h4>Do</h4>
        <ul>
          <li>Use the logo at minimum 32px height</li>
          <li>Maintain clear space equal to the mark height</li>
          <li>Use brand colors consistently across all touchpoints</li>
          <li>Keep the brand voice in all communications</li>
        </ul>
      </div>
      <div class="guideline-card guideline-dont">
        <h4>Don't</h4>
        <ul>
          <li>Stretch or distort the logo</li>
          <li>Place logo on low-contrast backgrounds</li>
          <li>Use more than 2 brand colors per layout</li>
          <li>Substitute the specified typefaces</li>
        </ul>
      </div>
    </div>
  </section>

  <footer class="footer">
    ${h(project.name)} Brand Brief &middot; Generated ${new Date().toLocaleDateString()} &middot; Greenlight Studio
  </footer>
</body>
</html>`;
}

export async function generateBrandBriefPptx(
  project: ProjectInfo,
  packet: Phase1Packet,
  images: BrandImage[],
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  const kit = packet.brand_kit;
  const primary = kit.color_palette[0] ?? "#6EE7B7";
  const bg = kit.color_palette[2] ?? "#0A0F1C";

  pptx.author = "Greenlight Studio";
  pptx.title = `${project.name} Brand Brief`;
  pptx.subject = "Brand Identity Guidelines";

  const bgHex = bg.replace("#", "");
  const primaryHex = primary.replace("#", "");

  // --- Cover Slide ---
  const coverSlide = pptx.addSlide();
  coverSlide.background = { color: bgHex };
  coverSlide.addText("BRAND BRIEF", {
    x: 0.8,
    y: 0.8,
    w: 8,
    fontSize: 12,
    fontFace: "Helvetica Neue",
    color: primaryHex,
    bold: true,
    charSpacing: 6,
  });
  coverSlide.addText(project.name, {
    x: 0.8,
    y: 1.8,
    w: 8,
    fontSize: 44,
    fontFace: "Helvetica Neue",
    color: "F8FAFC",
    bold: true,
  });
  coverSlide.addText(project.idea_description.slice(0, 200), {
    x: 0.8,
    y: 3.2,
    w: 7,
    fontSize: 14,
    fontFace: "Helvetica Neue",
    color: "94A3B8",
    lineSpacingMultiple: 1.5,
  });

  // --- Logo Slide ---
  const logoSlide = pptx.addSlide();
  logoSlide.background = { color: bgHex };
  logoSlide.addText("LOGO", {
    x: 0.8,
    y: 0.4,
    fontSize: 11,
    fontFace: "Helvetica Neue",
    color: primaryHex,
    bold: true,
    charSpacing: 6,
  });
  logoSlide.addText("Brand Mark", {
    x: 0.8,
    y: 0.8,
    fontSize: 28,
    fontFace: "Helvetica Neue",
    color: "F8FAFC",
    bold: true,
  });
  logoSlide.addText(kit.logo_prompt, {
    x: 0.8,
    y: 1.6,
    w: 7,
    fontSize: 13,
    fontFace: "Helvetica Neue",
    color: "94A3B8",
    lineSpacingMultiple: 1.4,
  });

  const logoImage = images.find((i) => i.filename.startsWith("logo"));
  if (logoImage) {
    const ext = logoImage.mimeType.includes("svg") ? "image/svg+xml" : logoImage.mimeType;
    const dataUrl = `data:${ext};base64,${logoImage.buffer.toString("base64")}`;
    logoSlide.addImage({ data: dataUrl, x: 2.5, y: 2.8, w: 2, h: 2 });
  }

  // --- Color Palette Slide ---
  const colorSlide = pptx.addSlide();
  colorSlide.background = { color: bgHex };
  colorSlide.addText("COLOR", {
    x: 0.8,
    y: 0.4,
    fontSize: 11,
    fontFace: "Helvetica Neue",
    color: primaryHex,
    bold: true,
    charSpacing: 6,
  });
  colorSlide.addText("Color Palette", {
    x: 0.8,
    y: 0.8,
    fontSize: 28,
    fontFace: "Helvetica Neue",
    color: "F8FAFC",
    bold: true,
  });

  kit.color_palette.forEach((color, i) => {
    const xPos = 0.8 + i * 2.2;
    const labels = ["Primary", "Secondary", "Background", "Accent"];
    colorSlide.addShape(pptx.ShapeType.roundRect, {
      x: xPos,
      y: 1.8,
      w: 1.6,
      h: 1.6,
      fill: { color: color.replace("#", "") },
      rectRadius: 0.15,
    });
    colorSlide.addText(color, {
      x: xPos,
      y: 3.5,
      w: 1.6,
      fontSize: 11,
      fontFace: "Courier New",
      color: "94A3B8",
      align: "center",
    });
    colorSlide.addText(labels[i] ?? `Accent ${i}`, {
      x: xPos,
      y: 3.9,
      w: 1.6,
      fontSize: 10,
      fontFace: "Helvetica Neue",
      color: "64748B",
      align: "center",
    });
  });

  // --- Typography Slide ---
  const typeSlide = pptx.addSlide();
  typeSlide.background = { color: bgHex };
  typeSlide.addText("TYPOGRAPHY", {
    x: 0.8,
    y: 0.4,
    fontSize: 11,
    fontFace: "Helvetica Neue",
    color: primaryHex,
    bold: true,
    charSpacing: 6,
  });
  typeSlide.addText(kit.font_pairing, {
    x: 0.8,
    y: 0.8,
    w: 8,
    fontSize: 28,
    fontFace: "Helvetica Neue",
    color: "F8FAFC",
    bold: true,
  });
  typeSlide.addText("The quick brown fox jumps over the lazy dog", {
    x: 0.8,
    y: 2.0,
    w: 8,
    fontSize: 32,
    fontFace: "Georgia",
    color: "F8FAFC",
  });
  typeSlide.addText(
    "Body text uses a clean geometric sans-serif for readability. The pairing of a display font with a refined body font creates visual hierarchy.",
    {
      x: 0.8,
      y: 3.2,
      w: 7,
      fontSize: 14,
      fontFace: "Helvetica Neue",
      color: "94A3B8",
      lineSpacingMultiple: 1.5,
    },
  );

  // --- Voice & Tone Slide ---
  const voiceSlide = pptx.addSlide();
  voiceSlide.background = { color: bgHex };
  voiceSlide.addText("VOICE & TONE", {
    x: 0.8,
    y: 0.4,
    fontSize: 11,
    fontFace: "Helvetica Neue",
    color: primaryHex,
    bold: true,
    charSpacing: 6,
  });
  voiceSlide.addText("How We Speak", {
    x: 0.8,
    y: 0.8,
    fontSize: 28,
    fontFace: "Helvetica Neue",
    color: "F8FAFC",
    bold: true,
  });
  voiceSlide.addShape(pptx.ShapeType.roundRect, {
    x: 0.8,
    y: 1.6,
    w: 8,
    h: 2.5,
    fill: { color: "0F172A" },
    line: { color: "1E293B", width: 1 },
    rectRadius: 0.15,
  });
  voiceSlide.addText(kit.voice, {
    x: 1.1,
    y: 1.9,
    w: 7.4,
    fontSize: 15,
    fontFace: "Helvetica Neue",
    color: "CBD5E1",
    lineSpacingMultiple: 1.6,
  });

  const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return Buffer.from(buf);
}
