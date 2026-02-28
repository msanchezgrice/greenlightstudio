import PptxGenJS from "pptxgenjs";
import type { BrandImage } from "@/lib/brand-generator";
import type { BrandBriefDeckSpec, BrandBriefSlide } from "@/types/brand-brief";

type ProjectInfo = {
  id: string;
  name: string;
  domain: string | null;
  idea_description: string;
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

function ensureFont(input: string, label: string): string {
  const value = input.trim();
  if (value.length < 2) {
    throw new Error(`Invalid ${label} font: ${input}`);
  }
  return value;
}

function cssFontParam(name: string): string {
  return name.trim().replace(/\s+/g, "+");
}

function imageDataUrlMap(images: BrandImage[]) {
  const map: Record<string, string> = {};
  for (const image of images) {
    const key = image.filename.replace(/\.\w+$/, "").toLowerCase();
    map[key] = `data:${image.mimeType};base64,${image.buffer.toString("base64")}`;
  }
  return map;
}

function requireImage(images: Record<string, string>, key: "logo" | "hero", slideTitle: string): string {
  const image = images[key];
  if (!image) {
    throw new Error(`Missing ${key} image required by slide: ${slideTitle}`);
  }
  return image;
}

function bulletListHtml(lines: string[]) {
  if (!lines.length) return "";
  return `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`;
}

function renderSlideContentHtml(slide: BrandBriefSlide, images: Record<string, string>): string {
  const bulletsHtml = bulletListHtml(slide.bullets);
  const doHtml = bulletListHtml(slide.do ?? []);
  const dontHtml = bulletListHtml(slide.dont ?? []);
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
          <img src="${imageSrc}" alt="${escapeHtml(slide.title)}"/>
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
    ? `<div class="panel image-panel"><img src="${imageSrc}" alt="${escapeHtml(slide.title)}"/></div>`
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

function renderHtmlSlide(project: ProjectInfo, slide: BrandBriefSlide, images: Record<string, string>, index: number) {
  const coverMeta = `${escapeHtml(project.name)}${project.domain ? ` · ${escapeHtml(project.domain)}` : ""}`;

  return `
    <section class="slide ${slide.kind === "cover" ? "cover" : ""}" data-layout="${slide.layout}">
      <div class="slide-inner">
        <div class="slide-header">
          <div class="kicker">${escapeHtml(slide.kicker)}</div>
          <div class="slide-index">${index + 1}</div>
        </div>
        <h1>${escapeHtml(slide.title)}</h1>
        ${slide.subtitle ? `<p class="subtitle">${escapeHtml(slide.subtitle)}</p>` : ""}
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
  const text = normalizeHex(spec.style_tokens.text, "text");
  const muted = normalizeHex(spec.style_tokens.muted_text, "muted_text");
  const accent = normalizeHex(spec.style_tokens.accent, "accent");
  const accent2 = normalizeHex(spec.style_tokens.accent_secondary, "accent_secondary");

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
  const bullets = lines.map((line) => ({ text: line, options: { bullet: { indent: 14 } } }));
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
  });
}

function addCommonFrame(
  pptx: PptxGenJS,
  deckSlide: PptxGenJS.Slide,
  spec: BrandBriefDeckSpec,
  slide: BrandBriefSlide,
  index: number,
) {
  const background = normalizeHexNoHash(spec.style_tokens.background, "background");
  const surface = normalizeHexNoHash(spec.style_tokens.surface, "surface");
  const text = normalizeHexNoHash(spec.style_tokens.text, "text");
  const muted = normalizeHexNoHash(spec.style_tokens.muted_text, "muted_text");
  const accent = normalizeHexNoHash(spec.style_tokens.accent, "accent");
  const headingFont = ensureFont(spec.typography.heading_font, "heading");
  const bodyFont = ensureFont(spec.typography.body_font, "body");

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
  images: Record<string, string>,
) {
  const { bodyFont, text, muted, surface, accent } = frame;

  if (slide.kind === "palette") {
    const colors = slide.palette_focus;
    slideRef.addText(slide.body ?? "", {
      x: 0.76,
      y: 3.0,
      w: 7.0,
      h: 0.9,
      fontFace: bodyFont,
      fontSize: 14,
      color: muted,
      breakLine: true,
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
      slideRef.addText(slide.body, {
        x: 0.76,
        y: 3.0,
        w: 6.8,
        h: 1,
        fontFace: bodyFont,
        fontSize: 14,
        color: muted,
        breakLine: true,
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
    slideRef.addText(slide.body, {
      x: textX,
      y: slide.subtitle ? 2.9 : 2.45,
      w: textW,
      h: 1.2,
      fontFace: bodyFont,
      fontSize: 14,
      color: muted,
      breakLine: true,
      lineSpacingMultiple: 1.25,
    });
  }

  if (slide.layout === "grid") {
    const cards = slide.bullets.slice(0, 6);
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
      slideRef.addShape(pptx.ShapeType.roundRect, {
        x: 8.05,
        y: 1.86,
        w: 4.6,
        h: 4.9,
        fill: { color: surface, transparency: 8 },
        line: { color: accent, transparency: 50, pt: 1 },
        rectRadius: 0.08,
      });
      slideRef.addImage({ data: imageData, x: 8.12, y: 1.94, w: 4.46, h: 4.74 });
    } else {
      const imageX = slide.layout === "split_image_left" ? 0.8 : 8.15;

      slideRef.addShape(pptx.ShapeType.roundRect, {
        x: imageX - 0.08,
        y: 2.35,
        w: 4.55,
        h: 3.35,
        fill: { color: surface, transparency: 14 },
        line: { color: accent, transparency: 54, pt: 1 },
        rectRadius: 0.08,
      });
      slideRef.addImage({ data: imageData, x: imageX, y: 2.43, w: 4.39, h: 3.19 });
    }
  }
}

function renderPptSlide(
  pptx: PptxGenJS,
  spec: BrandBriefDeckSpec,
  slide: BrandBriefSlide,
  index: number,
  images: Record<string, string>,
) {
  const deckSlide = pptx.addSlide();
  const frame = addCommonFrame(pptx, deckSlide, spec, slide, index);
  const bodyFont = frame.bodyFont;
  const muted = frame.muted;

  if (slide.subtitle) {
    deckSlide.addText(slide.subtitle, {
      x: 0.76,
      y: slide.kind === "cover" ? 2.3 : 2.05,
      w: 7.8,
      h: 0.8,
      fontFace: bodyFont,
      fontSize: 17,
      color: "D9E5F2",
      breakLine: true,
    });
  }

  if (slide.kind === "cover") {
    deckSlide.addText(spec.visual_direction, {
      x: 0.76,
      y: 3.12,
      w: 7.2,
      h: 0.8,
      fontFace: bodyFont,
      fontSize: 14,
      color: muted,
      breakLine: true,
      italic: true,
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
    deckSlide.addText(spec.narrative, {
      x: 0.76,
      y: 5.12,
      w: 11.2,
      h: 0.75,
      fontFace: bodyFont,
      fontSize: 12,
      color: muted,
      breakLine: true,
      italic: true,
    });
  }

  if (slide.kind === "cover") {
    const hero = images.hero;
    if (hero) {
      deckSlide.addShape(pptx.ShapeType.roundRect, {
        x: 8.0,
        y: 1.6,
        w: 4.65,
        h: 4.9,
        fill: { color: frame.surface, transparency: 15 },
        line: { color: frame.accent, transparency: 55, pt: 1 },
        rectRadius: 0.08,
      });
      deckSlide.addImage({ data: hero, x: 8.08, y: 1.68, w: 4.5, h: 4.74 });
    }

    if (slide.body) {
      deckSlide.addText(slide.body, {
        x: 0.76,
        y: 3.9,
        w: 7.0,
        h: 1.2,
        fontFace: bodyFont,
        fontSize: 15,
        color: muted,
        breakLine: true,
        lineSpacingMultiple: 1.25,
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
