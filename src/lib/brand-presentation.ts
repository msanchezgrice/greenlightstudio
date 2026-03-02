import PptxGenJS from "pptxgenjs";
import type { BrandImage } from "@/lib/brand-generator";
import type { BrandBriefDeckSpec, BrandBriefSlide } from "@/types/brand-brief";

type ProjectInfo = {
  id: string;
  name: string;
  domain: string | null;
  idea_description: string;
};

type RenderImage = {
  dataUrl: string;
  width: number;
  height: number;
};

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeHex(input: string, label: string): string {
  const value = input.trim();
  const body = value.startsWith("#") ? value.slice(1) : value;
  if (!/^[0-9a-fA-F]{6}$/.test(body)) {
    throw new Error(`Invalid ${label} color: ${input}`);
  }
  return `#${body.toUpperCase()}`;
}

function normalizeHexNoHash(input: string, label: string): string {
  return normalizeHex(input, label).slice(1);
}

function hexToRgb(hex: string) {
  const value = hex.startsWith("#") ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function channelToLinear(value: number) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  return 0.2126 * channelToLinear(rgb.r) + 0.7152 * channelToLinear(rgb.g) + 0.0722 * channelToLinear(rgb.b);
}

function contrastRatio(foreground: string, background: string) {
  const a = luminance(foreground);
  const b = luminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function preferredReadableText(background: string) {
  const dark = "#0F172A";
  const light = "#F8FAFC";
  return contrastRatio(dark, background) >= contrastRatio(light, background) ? dark : light;
}

function ensureReadableColor(
  candidate: string,
  background: string,
  minContrast: number,
  fallback: string,
) {
  if (contrastRatio(candidate, background) >= minContrast) return candidate;
  if (contrastRatio(fallback, background) >= minContrast) return fallback;
  return preferredReadableText(background);
}

function ensureFont(input: string, label: string): string {
  const value = input.trim();
  if (value.length < 2) {
    throw new Error(`Invalid ${label} font: ${input}`);
  }
  return value;
}

function resolvePptFont(input: string, fallback: string): string {
  const safe = new Set([
    "Arial",
    "Calibri",
    "Cambria",
    "Helvetica",
    "Helvetica Neue",
    "Times New Roman",
    "Georgia",
    "Verdana",
    "Tahoma",
    "Trebuchet MS",
    "Gill Sans",
  ]);
  return safe.has(input) ? input : fallback;
}

function cssFontParam(name: string): string {
  return name.trim().replace(/\s+/g, "+");
}

function parseImageDimensions(buffer: Buffer, mimeType: string): { width: number; height: number } {
  // PNG: width/height are fixed offsets in IHDR chunk.
  if (mimeType === "image/png" && buffer.length >= 24) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width > 0 && height > 0) return { width, height };
  }

  // JPEG: scan SOF markers for width/height.
  if ((mimeType === "image/jpeg" || mimeType === "image/jpg") && buffer.length > 4) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const size = buffer.readUInt16BE(offset + 2);
      if (size < 2) break;
      const isSof =
        marker === 0xc0 ||
        marker === 0xc1 ||
        marker === 0xc2 ||
        marker === 0xc3 ||
        marker === 0xc5 ||
        marker === 0xc6 ||
        marker === 0xc7 ||
        marker === 0xc9 ||
        marker === 0xca ||
        marker === 0xcb ||
        marker === 0xcd ||
        marker === 0xce ||
        marker === 0xcf;
      if (isSof && offset + 8 < buffer.length) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        if (width > 0 && height > 0) return { width, height };
      }
      offset += 2 + size;
    }
  }

  return { width: 1600, height: 900 };
}

function imageDataUrlMap(images: BrandImage[]) {
  const map: Record<string, RenderImage> = {};
  for (const image of images) {
    const key = image.filename.replace(/\.\w+$/, "").toLowerCase();
    const dimensions = parseImageDimensions(image.buffer, image.mimeType);
    map[key] = {
      dataUrl: `data:${image.mimeType};base64,${image.buffer.toString("base64")}`,
      width: dimensions.width,
      height: dimensions.height,
    };
  }
  return map;
}

function requireImage(images: Record<string, RenderImage>, key: "logo" | "hero", slideTitle: string): RenderImage {
  const image = images[key];
  if (!image) {
    throw new Error(`Missing ${key} image required by slide: ${slideTitle}`);
  }
  return image;
}

function fitImageWithinBox(image: RenderImage, box: { x: number; y: number; w: number; h: number }) {
  const ratio = image.width > 0 && image.height > 0 ? image.width / image.height : box.w / box.h;
  if (!Number.isFinite(ratio) || ratio <= 0) return box;
  const boxRatio = box.w / box.h;
  if (ratio > boxRatio) {
    const w = box.w;
    const h = w / ratio;
    return { x: box.x, y: box.y + (box.h - h) / 2, w, h };
  }
  const h = box.h;
  const w = h * ratio;
  return { x: box.x + (box.w - w) / 2, y: box.y, w, h };
}

function clampText(value: string | null | undefined, maxChars: number) {
  if (!value) return "";
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars - 1).trimEnd()}…`;
}

function clampLines(lines: string[], maxItems: number, maxChars: number) {
  return lines
    .slice(0, maxItems)
    .map((line) => clampText(line, maxChars))
    .filter((line) => line.length > 0);
}

function bulletListHtml(lines: string[]) {
  if (!lines.length) return "";
  return `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`;
}

function renderSlideContentHtml(slide: BrandBriefSlide, images: Record<string, RenderImage>): string {
  const bulletsHtml = bulletListHtml(clampLines(slide.bullets, 7, 180));
  const doHtml = bulletListHtml(clampLines(slide.do ?? [], 6, 140));
  const dontHtml = bulletListHtml(clampLines(slide.dont ?? [], 6, 140));
  const imageKey = slide.image_key;
  const imageSrc = imageKey ? requireImage(images, imageKey, slide.title) : null;

  if (slide.kind === "palette") {
    const colors = slide.palette_focus;
    return `
      <div class="content-wrap">
        ${slide.body ? `<p class="body">${escapeHtml(slide.body)}</p>` : ""}
        <div class="palette-grid">
          ${colors
            .map(
              (color, colorIndex) => `
            <div class="swatch">
              <div class="swatch-chip" style="background:${escapeHtml(color)}"></div>
              <code>${escapeHtml(color)}</code>
              <span>${
                colorIndex === 0
                  ? "Primary"
                  : colorIndex === 1
                    ? "Secondary"
                    : colorIndex === 2
                      ? "Background"
                      : `Accent ${colorIndex}`
              }</span>
            </div>`,
            )
            .join("")}
        </div>
        ${bulletsHtml}
      </div>`;
  }

  if (slide.kind === "guidelines") {
    return `
      <div class="content-wrap">
        ${slide.body ? `<p class="body">${escapeHtml(slide.body)}</p>` : ""}
        <div class="rules-grid">
          <div class="rule-card rule-do">
            <h3>Do</h3>
            ${doHtml}
          </div>
          <div class="rule-card rule-dont">
            <h3>Do Not</h3>
            ${dontHtml}
          </div>
        </div>
      </div>`;
  }

  if (slide.layout === "full_image") {
    if (!imageSrc) {
      throw new Error(`Slide requires image but none provided: ${slide.title}`);
    }

    return `
      <div class="content-wrap full-image">
        <div class="full-image-frame">
          <img src="${imageSrc.dataUrl}" alt="${escapeHtml(slide.title)}"/>
          <div class="full-image-overlay">
            ${slide.body ? `<p class="body">${escapeHtml(slide.body)}</p>` : ""}
            ${bulletsHtml}
          </div>
        </div>
      </div>`;
  }

  const leftHtml = `
      <div class="panel text-panel">
        ${slide.body ? `<p class="body">${escapeHtml(slide.body)}</p>` : ""}
        ${bulletsHtml}
      </div>`;

  const rightImageHtml = imageSrc
    ? `<div class="panel image-panel"><img src="${imageSrc.dataUrl}" alt="${escapeHtml(slide.title)}"/></div>`
    : "";

  if (slide.layout === "split_image_left") {
    return `<div class="content-wrap split">${rightImageHtml}${leftHtml}</div>`;
  }

  if (slide.layout === "split_image_right" || slide.layout === "spotlight") {
    return `<div class="content-wrap split">${leftHtml}${rightImageHtml}</div>`;
  }

  if (slide.layout === "grid") {
    return `
      <div class="content-wrap grid-layout">
        ${slide.body ? `<p class="body">${escapeHtml(slide.body)}</p>` : ""}
        <div class="bullet-grid">
          ${slide.bullets
            .map(
              (line) => `
            <article class="bullet-card">
              <p>${escapeHtml(line)}</p>
            </article>`,
            )
            .join("")}
        </div>
      </div>`;
  }

  return `
      <div class="content-wrap statement-layout">
        ${slide.body ? `<p class="body">${escapeHtml(slide.body)}</p>` : ""}
        ${bulletsHtml}
      </div>`;
}

function renderHtmlSlide(project: ProjectInfo, slide: BrandBriefSlide, images: Record<string, RenderImage>, index: number) {
  const coverMeta = `${escapeHtml(project.name)}${project.domain ? ` · ${escapeHtml(project.domain)}` : ""}`;

  return `
    <section class="slide ${slide.kind === "cover" ? "cover" : ""}" data-layout="${slide.layout}">
      <div class="slide-inner">
        <div class="slide-header">
          <div class="kicker">${escapeHtml(slide.kicker)}</div>
          <div class="slide-index">${index + 1}</div>
        </div>
        <h1>${escapeHtml(slide.title)}</h1>
        ${slide.subtitle ? `<p class="subtitle">${escapeHtml(clampText(slide.subtitle, 180))}</p>` : ""}
        ${renderSlideContentHtml(slide, images)}
        ${slide.kind === "cover" ? `<p class="meta">${coverMeta}</p>` : ""}
      </div>
    </section>`;
}

export function renderBrandBriefHtml(
  project: ProjectInfo,
  images: BrandImage[],
  spec: BrandBriefDeckSpec,
): string {
  const headingFont = ensureFont(spec.typography.heading_font, "heading");
  const bodyFont = ensureFont(spec.typography.body_font, "body");

  const bg = normalizeHex(spec.style_tokens.background, "background");
  const surface = normalizeHex(spec.style_tokens.surface, "surface");
  const textRaw = normalizeHex(spec.style_tokens.text, "text");
  const mutedRaw = normalizeHex(spec.style_tokens.muted_text, "muted_text");
  const accentRaw = normalizeHex(spec.style_tokens.accent, "accent");
  const accent2Raw = normalizeHex(spec.style_tokens.accent_secondary, "accent_secondary");

  const text = ensureReadableColor(textRaw, surface, 4.5, preferredReadableText(surface));
  const muted = ensureReadableColor(
    mutedRaw,
    surface,
    3,
    text === "#0F172A" ? "#475569" : "#94A3B8",
  );
  const accent = ensureReadableColor(
    accentRaw,
    surface,
    2.2,
    text === "#0F172A" ? "#2563EB" : "#38BDF8",
  );
  const accent2 = ensureReadableColor(
    accent2Raw,
    surface,
    2.2,
    text === "#0F172A" ? "#0EA5E9" : "#60A5FA",
  );

  const imageMap = imageDataUrlMap(images);
  const slidesHtml = spec.slides.map((slide, index) => renderHtmlSlide(project, slide, imageMap, index)).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml(project.name)} Brand Brief</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=${cssFontParam(headingFont)}:wght@500;600;700;800&family=${cssFontParam(bodyFont)}:wght@400;500;600;700&display=swap" rel="stylesheet"/>
  <style>
    :root {
      --bg: ${bg};
      --surface: ${surface};
      --text: ${text};
      --muted: ${muted};
      --accent: ${accent};
      --accent2: ${accent2};
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: '${escapeHtml(bodyFont)}', system-ui, sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at 20% 8%, color-mix(in srgb, var(--accent) 26%, transparent), transparent 46%),
        radial-gradient(circle at 82% 14%, color-mix(in srgb, var(--accent2) 22%, transparent), transparent 48%),
        linear-gradient(150deg, var(--bg), #050912 78%);
      -webkit-font-smoothing: antialiased;
    }
    .slide {
      min-height: 100vh;
      padding: 60px 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-top: 1px solid rgba(255,255,255,.08);
    }
    .slide.cover { border-top: none; }
    .slide-inner {
      width: min(1080px, 100%);
      background: linear-gradient(170deg, color-mix(in srgb, var(--surface) 88%, #03070f), #060d1b);
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 24px;
      box-shadow: 0 34px 100px rgba(0,0,0,.42);
      padding: 42px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .slide-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .kicker {
      text-transform: uppercase;
      letter-spacing: .12em;
      font-weight: 700;
      font-size: 11px;
      color: var(--accent);
    }
    .slide-index {
      font-size: 12px;
      color: var(--muted);
      border: 1px solid rgba(255,255,255,.14);
      padding: 4px 8px;
      border-radius: 999px;
    }
    h1 {
      font-family: '${escapeHtml(headingFont)}', sans-serif;
      line-height: 1.06;
      font-size: clamp(34px, 5vw, 68px);
      letter-spacing: -.02em;
    }
    .subtitle {
      font-size: clamp(18px, 2.2vw, 28px);
      color: color-mix(in srgb, var(--text) 82%, #B3C3D7);
      max-width: 900px;
    }
    .meta {
      color: var(--accent2);
      font-size: 12px;
      letter-spacing: .08em;
      text-transform: uppercase;
      margin-top: 4px;
      font-weight: 600;
    }
    .content-wrap { display: flex; flex-direction: column; gap: 16px; }
    .body {
      font-size: 16px;
      line-height: 1.72;
      color: var(--muted);
      max-width: 900px;
      white-space: pre-wrap;
    }
    .split {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
      align-items: stretch;
    }
    .panel {
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,.12);
      background: linear-gradient(165deg, rgba(255,255,255,.02), rgba(255,255,255,.01));
      padding: 20px;
      min-height: 220px;
    }
    .image-panel { padding: 10px; overflow: hidden; }
    .image-panel img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 12px;
      display: block;
    }
    .full-image-frame {
      position: relative;
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,.13);
      min-height: 360px;
      background: #09111e;
    }
    .full-image-frame img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: .9;
    }
    .full-image-overlay {
      position: relative;
      z-index: 1;
      min-height: 360px;
      background: linear-gradient(160deg, rgba(5,9,18,.78), rgba(5,9,18,.42));
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      justify-content: flex-end;
    }
    ul {
      margin-left: 18px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    li {
      color: color-mix(in srgb, var(--text) 90%, #C6D5E5);
      line-height: 1.5;
      font-size: 15px;
    }
    .bullet-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 12px;
    }
    .bullet-card {
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,.14);
      background: color-mix(in srgb, var(--surface) 75%, black);
      padding: 14px;
      min-height: 88px;
      display: flex;
      align-items: center;
    }
    .bullet-card p {
      font-size: 14px;
      line-height: 1.5;
      color: color-mix(in srgb, var(--text) 86%, #B6C5D8);
    }
    .palette-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 12px;
      margin-top: 6px;
    }
    .swatch {
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,.11);
      background: rgba(255,255,255,.02);
      padding: 10px;
      text-align: center;
    }
    .swatch-chip {
      height: 92px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,.13);
      margin-bottom: 8px;
    }
    .swatch code {
      display: block;
      font-size: 12px;
      color: color-mix(in srgb, var(--text) 80%, #B9C9DA);
      margin-bottom: 2px;
    }
    .swatch span {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: .07em;
      color: var(--muted);
    }
    .rules-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }
    .rule-card {
      border-radius: 14px;
      padding: 18px;
      border: 1px solid rgba(255,255,255,.1);
      background: rgba(255,255,255,.03);
    }
    .rule-card h3 {
      font-size: 12px;
      letter-spacing: .12em;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .rule-do { border-color: color-mix(in srgb, #31D08D 42%, transparent); }
    .rule-do h3 { color: #31D08D; }
    .rule-dont { border-color: color-mix(in srgb, #FF6B7D 42%, transparent); }
    .rule-dont h3 { color: #FF6B7D; }
    @media (max-width: 900px) {
      .slide { padding: 38px 12px; }
      .slide-inner { padding: 26px; }
      .split, .rules-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  ${slidesHtml}
</body>
</html>`;
}

function addBullets(
  slideRef: PptxGenJS.Slide,
  lines: string[],
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  fontFace: string,
  fontSize = 16,
) {
  if (!lines.length) return;
  const bullets = clampLines(lines, 8, 140).map((line) => ({ text: line, options: { bullet: { indent: 14 } } }));
  slideRef.addText(bullets, {
    x,
    y,
    w,
    h,
    fontFace,
    fontSize,
    color,
    breakLine: true,
    margin: 0.05,
    paraSpaceAfter: 8,
    valign: "top",
    fit: "shrink",
  });
}

function addCommonFrame(
  pptx: PptxGenJS,
  deckSlide: PptxGenJS.Slide,
  spec: BrandBriefDeckSpec,
  slide: BrandBriefSlide,
  index: number,
) {
  const backgroundRaw = normalizeHex(spec.style_tokens.background, "background");
  const surfaceRaw = normalizeHex(spec.style_tokens.surface, "surface");
  const textRaw = normalizeHex(spec.style_tokens.text, "text");
  const mutedRaw = normalizeHex(spec.style_tokens.muted_text, "muted_text");
  const accentRaw = normalizeHex(spec.style_tokens.accent, "accent");

  const textHex = ensureReadableColor(textRaw, surfaceRaw, 4.5, preferredReadableText(surfaceRaw));
  const mutedHex = ensureReadableColor(
    mutedRaw,
    surfaceRaw,
    3,
    textHex === "#0F172A" ? "#475569" : "#94A3B8",
  );
  const accentHex = ensureReadableColor(
    accentRaw,
    surfaceRaw,
    2.2,
    textHex === "#0F172A" ? "#2563EB" : "#38BDF8",
  );

  const background = normalizeHexNoHash(backgroundRaw, "background");
  const surface = normalizeHexNoHash(surfaceRaw, "surface");
  const text = normalizeHexNoHash(textHex, "text");
  const muted = normalizeHexNoHash(mutedHex, "muted_text");
  const accent = normalizeHexNoHash(accentHex, "accent");

  const headingFont = resolvePptFont(ensureFont(spec.typography.heading_font, "heading"), "Helvetica Neue");
  const bodyFont = resolvePptFont(ensureFont(spec.typography.body_font, "body"), "Calibri");

  deckSlide.background = { color: background };

  deckSlide.addShape(pptx.ShapeType.roundRect, {
    x: 0.28,
    y: 0.22,
    w: 12.76,
    h: 6.63,
    fill: { color: surface, transparency: 7 },
    line: { color: "FFFFFF", transparency: 90, pt: 1 },
    rectRadius: 0.12,
  });

  deckSlide.addText(slide.kicker, {
    x: 0.72,
    y: 0.48,
    w: 7,
    h: 0.3,
    fontFace: bodyFont,
    fontSize: 12,
    bold: true,
    color: accent,
    charSpacing: 2.5,
  });

  deckSlide.addText(String(index + 1), {
    x: 12.2,
    y: 0.45,
    w: 0.6,
    h: 0.3,
    align: "right",
    fontFace: bodyFont,
    fontSize: 10,
    color: muted,
  });

  deckSlide.addText(slide.title, {
    x: 0.72,
    y: 0.9,
    w: 8.5,
    h: 1.2,
    fontFace: headingFont,
    fontSize: slide.kind === "cover" ? 42 : 34,
    color: text,
    bold: true,
    breakLine: true,
    fit: "shrink",
  });

  return {
    headingFont,
    bodyFont,
    text,
    muted,
    accent,
    surface,
    background,
  };
}

function renderSlideBodyPpt(
  pptx: PptxGenJS,
  slideRef: PptxGenJS.Slide,
  slide: BrandBriefSlide,
  frame: {
    bodyFont: string;
    text: string;
    muted: string;
    surface: string;
    accent: string;
  },
  images: Record<string, RenderImage>,
) {
  const { bodyFont, text, muted, surface, accent } = frame;

  if (slide.kind === "palette") {
    const colors = slide.palette_focus;
    slideRef.addText(clampText(slide.body, 320), {
      x: 0.76,
      y: 3.0,
      w: 7.0,
      h: 0.9,
      fontFace: bodyFont,
      fontSize: 14,
      color: muted,
      breakLine: true,
      fit: "shrink",
    });

    colors.forEach((color, idx) => {
      const x = 8.1 + (idx % 2) * 2.25;
      const y = 1.4 + Math.floor(idx / 2) * 1.65;
      slideRef.addShape(pptx.ShapeType.roundRect, {
        x,
        y,
        w: 1.8,
        h: 1.2,
        fill: { color: normalizeHexNoHash(color, `palette_focus.${idx}`) },
        line: { color: "FFFFFF", transparency: 85, pt: 1 },
        rectRadius: 0.09,
      });
      slideRef.addText(normalizeHex(color, `palette_focus.${idx}`), {
        x,
        y: y + 1.24,
        w: 1.8,
        h: 0.24,
        align: "center",
        fontFace: bodyFont,
        fontSize: 9,
        color: muted,
      });
    });

    addBullets(slideRef, slide.bullets, 0.82, 3.92, 6.9, 2.0, text, bodyFont, 15);
    return;
  }

  if (slide.kind === "guidelines") {
    if (slide.body) {
      slideRef.addText(clampText(slide.body, 320), {
        x: 0.76,
        y: 3.0,
        w: 6.8,
        h: 1,
        fontFace: bodyFont,
        fontSize: 14,
        color: muted,
        breakLine: true,
        fit: "shrink",
      });
    }

    slideRef.addShape(pptx.ShapeType.roundRect, {
      x: 7.95,
      y: 2.0,
      w: 2.35,
      h: 3.95,
      fill: { color: "123123", transparency: 65 },
      line: { color: "31D08D", transparency: 45, pt: 1 },
      rectRadius: 0.1,
    });
    slideRef.addText("DO", {
      x: 8.12,
      y: 2.14,
      w: 2.0,
      h: 0.24,
      color: "31D08D",
      fontFace: bodyFont,
      fontSize: 11,
      bold: true,
      charSpacing: 1.5,
    });
    addBullets(slideRef, slide.do ?? [], 8.1, 2.44, 2.05, 3.38, "E8FFF4", bodyFont, 12);

    slideRef.addShape(pptx.ShapeType.roundRect, {
      x: 10.45,
      y: 2.0,
      w: 2.45,
      h: 3.95,
      fill: { color: "33151A", transparency: 60 },
      line: { color: "FF6B7D", transparency: 42, pt: 1 },
      rectRadius: 0.1,
    });
    slideRef.addText("DO NOT", {
      x: 10.63,
      y: 2.14,
      w: 2.08,
      h: 0.24,
      color: "FF6B7D",
      fontFace: bodyFont,
      fontSize: 11,
      bold: true,
      charSpacing: 1.3,
    });
    addBullets(slideRef, slide.dont ?? [], 10.62, 2.44, 2.1, 3.38, "FFE9EE", bodyFont, 12);
    return;
  }

  if (slide.body) {
    const textX = slide.layout === "split_image_left" ? 5.25 : 0.76;
    const textW = slide.layout === "split_image_left" ? 3.45 : 6.8;
      slideRef.addText(clampText(slide.body, 380), {
        x: textX,
        y: slide.subtitle ? 2.9 : 2.45,
        w: textW,
        h: 1.2,
        fontFace: bodyFont,
        fontSize: 14,
        color: muted,
        breakLine: true,
        lineSpacingMultiple: 1.25,
        fit: "shrink",
      });
    }

  if (slide.layout === "grid") {
      const cards = clampLines(slide.bullets, 6, 110);
    cards.forEach((line, idx) => {
      const x = 0.78 + (idx % 3) * 2.33;
      const y = 4.0 + Math.floor(idx / 3) * 1.17;
      slideRef.addShape(pptx.ShapeType.roundRect, {
        x,
        y,
        w: 2.18,
        h: 1.0,
        fill: { color: surface, transparency: 28 },
        line: { color: "FFFFFF", transparency: 82, pt: 1 },
        rectRadius: 0.08,
      });
      slideRef.addText(line, {
        x: x + 0.16,
        y: y + 0.17,
        w: 1.86,
        h: 0.7,
        fontFace: bodyFont,
        fontSize: 12,
        color: text,
        valign: "middle",
        breakLine: true,
        fit: "shrink",
      });
    });
  } else {
    const bulletX = slide.layout === "split_image_left" ? 5.25 : 0.82;
    const bulletW = slide.layout === "split_image_left" ? 3.4 : 6.85;
    addBullets(slideRef, slide.bullets, bulletX, 4.05, bulletW, 2.2, text, bodyFont, 15);
  }

  const imageKey = slide.image_key;
  if (imageKey) {
      const imageData = requireImage(images, imageKey, slide.title);
      if (slide.layout === "full_image") {
        const box = { x: 8.12, y: 1.94, w: 4.46, h: 4.74 };
        const fitted = fitImageWithinBox(imageData, box);
        slideRef.addShape(pptx.ShapeType.roundRect, {
        x: 8.05,
        y: 1.86,
        w: 4.6,
        h: 4.9,
        fill: { color: surface, transparency: 8 },
        line: { color: accent, transparency: 50, pt: 1 },
        rectRadius: 0.08,
      });
        slideRef.addImage({ data: imageData.dataUrl, x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h });
      } else {
        const imageX = slide.layout === "split_image_left" ? 0.8 : 8.15;
        const box = { x: imageX, y: 2.43, w: 4.39, h: 3.19 };
        const fitted = fitImageWithinBox(imageData, box);

        slideRef.addShape(pptx.ShapeType.roundRect, {
        x: imageX - 0.08,
        y: 2.35,
        w: 4.55,
        h: 3.35,
        fill: { color: surface, transparency: 14 },
        line: { color: accent, transparency: 54, pt: 1 },
        rectRadius: 0.08,
      });
        slideRef.addImage({ data: imageData.dataUrl, x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h });
      }
    }
}

function renderPptSlide(
  pptx: PptxGenJS,
  spec: BrandBriefDeckSpec,
  slide: BrandBriefSlide,
  index: number,
  images: Record<string, RenderImage>,
) {
  const deckSlide = pptx.addSlide();
  const frame = addCommonFrame(pptx, deckSlide, spec, slide, index);
  const bodyFont = frame.bodyFont;
  const muted = frame.muted;

  if (slide.subtitle) {
    deckSlide.addText(clampText(slide.subtitle, 180), {
      x: 0.76,
      y: slide.kind === "cover" ? 2.3 : 2.05,
      w: 7.8,
      h: 0.8,
      fontFace: bodyFont,
      fontSize: 17,
      color: frame.text,
      breakLine: true,
      fit: "shrink",
    });
  }

  if (slide.kind === "cover") {
    deckSlide.addText(clampText(spec.visual_direction, 220), {
      x: 0.76,
      y: 3.12,
      w: 7.2,
      h: 0.8,
      fontFace: bodyFont,
      fontSize: 14,
      color: muted,
      breakLine: true,
      italic: true,
      fit: "shrink",
    });
  }

  if (slide.kind === "closing") {
    deckSlide.addShape(pptx.ShapeType.line, {
      x: 0.74,
      y: 6.06,
      w: 11.9,
      h: 0,
      line: { color: "FFFFFF", transparency: 84, pt: 1 },
    });
    deckSlide.addText(clampText(spec.narrative, 340), {
      x: 0.76,
      y: 5.12,
      w: 11.2,
      h: 0.75,
      fontFace: bodyFont,
      fontSize: 12,
      color: muted,
      breakLine: true,
      italic: true,
      fit: "shrink",
    });
  }

  if (slide.kind === "cover") {
    const hero = images.hero;
    if (hero) {
      const box = { x: 8.08, y: 1.68, w: 4.5, h: 4.74 };
      const fitted = fitImageWithinBox(hero, box);
      deckSlide.addShape(pptx.ShapeType.roundRect, {
        x: 8.0,
        y: 1.6,
        w: 4.65,
        h: 4.9,
        fill: { color: frame.surface, transparency: 15 },
        line: { color: frame.accent, transparency: 55, pt: 1 },
        rectRadius: 0.08,
      });
      deckSlide.addImage({ data: hero.dataUrl, x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h });
    }

    if (slide.body) {
      deckSlide.addText(clampText(slide.body, 280), {
        x: 0.76,
        y: 3.9,
        w: 7.0,
        h: 1.2,
        fontFace: bodyFont,
        fontSize: 15,
        color: muted,
        breakLine: true,
        lineSpacingMultiple: 1.25,
        fit: "shrink",
      });
    }

    addBullets(deckSlide, slide.bullets, 0.82, 5.15, 6.9, 1.35, frame.text, bodyFont, 13);
    return;
  }

  renderSlideBodyPpt(
    pptx,
    deckSlide,
    slide,
    {
      bodyFont: frame.bodyFont,
      text: frame.text,
      muted: frame.muted,
      surface: frame.surface,
      accent: frame.accent,
    },
    images,
  );
}

export async function generateBrandBriefPptx(
  project: ProjectInfo,
  images: BrandImage[],
  spec: BrandBriefDeckSpec,
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Greenlight Studio";
  pptx.title = `${project.name} Brand Brief`;
  pptx.subject = spec.visual_direction;
  pptx.company = "Greenlight Studio";

  const imageMap = imageDataUrlMap(images);
  for (const [index, slide] of spec.slides.entries()) {
    renderPptSlide(pptx, spec, slide, index, imageMap);
  }

  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return Buffer.from(buffer);
}
