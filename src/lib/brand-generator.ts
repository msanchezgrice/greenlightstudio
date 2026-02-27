import { GoogleGenAI } from "@google/genai";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { log_task } from "@/lib/supabase-mcp";

type BrandKit = {
  voice: string;
  color_palette: string[];
  font_pairing: string;
  logo_prompt: string;
};

export type BrandImage = {
  filename: string;
  storagePath: string;
  buffer: Buffer;
  mimeType: string;
  label: string;
};

function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY ?? process.env.NANOBANANA_GEMINI_API_KEY;
  if (!key) return null;
  return new GoogleGenAI({ apiKey: key });
}

async function generateImageFromGemini(
  ai: GoogleGenAI,
  prompt: string,
): Promise<Buffer | null> {
  try {
    const response = await ai.models.generateImages({
      model: "gemini-2.0-flash-exp",
      prompt,
      config: { numberOfImages: 1 },
    });

    const images = response.generatedImages;
    if (!images || images.length === 0) return null;

    const b64 = images[0].image?.imageBytes;
    if (!b64) return null;
    return Buffer.from(b64, "base64");
  } catch {
    return null;
  }
}

function generateFallbackLogoSvg(name: string, palette: string[]): Buffer {
  const primary = palette[0] ?? "#6EE7B7";
  const secondary = palette[1] ?? "#3B82F6";
  const initial = name.charAt(0).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${primary}"/>
      <stop offset="100%" stop-color="${secondary}"/>
    </linearGradient>
    <filter id="shadow">
      <feDropShadow dx="0" dy="4" stdDeviation="12" flood-color="${primary}" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#bg)" filter="url(#shadow)"/>
  <text x="256" y="256" text-anchor="middle" dominant-baseline="central" fill="#fff" font-family="system-ui,-apple-system,sans-serif" font-size="220" font-weight="800">${initial}</text>
</svg>`;
  return Buffer.from(svg, "utf-8");
}

function generateFallbackHeroSvg(name: string, palette: string[]): Buffer {
  const primary = palette[0] ?? "#6EE7B7";
  const secondary = palette[1] ?? "#3B82F6";
  const bg = palette[2] ?? "#0A0F1C";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <linearGradient id="heroBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${bg}"/>
      <stop offset="100%" stop-color="${primary}22"/>
    </linearGradient>
    <radialGradient id="glow" cx="70%" cy="30%">
      <stop offset="0%" stop-color="${primary}" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="${bg}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#heroBg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <circle cx="900" cy="200" r="180" fill="${secondary}" fill-opacity="0.08"/>
  <circle cx="300" cy="400" r="120" fill="${primary}" fill-opacity="0.06"/>
  <text x="600" y="290" text-anchor="middle" fill="#F8FAFC" font-family="system-ui,-apple-system,sans-serif" font-size="64" font-weight="800" letter-spacing="-2">${escapeXml(name)}</text>
  <text x="600" y="360" text-anchor="middle" fill="${primary}" font-family="system-ui,sans-serif" font-size="24" font-weight="500" opacity="0.8">Launching Soon</text>
</svg>`;
  return Buffer.from(svg, "utf-8");
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function generateBrandImages(
  projectId: string,
  projectName: string,
  brandKit: BrandKit,
): Promise<BrandImage[]> {
  const ai = getGeminiClient();
  const images: BrandImage[] = [];

  const logoPrompt = `Professional, clean, modern logo mark for a startup called "${projectName}". ${brandKit.logo_prompt}. Use colors: ${brandKit.color_palette.join(", ")}. Minimal, scalable, icon-style logo suitable for app icon and favicon. White or transparent background. No text in the logo.`;
  const heroPrompt = `Professional hero banner image for a startup called "${projectName}". Brand voice: ${brandKit.voice}. Abstract, modern, atmospheric background using brand colors ${brandKit.color_palette.join(", ")}. Suitable for website hero section and social media Open Graph image. 1200x630 aspect ratio. No text.`;

  if (ai) {
    await log_task(projectId, "brand_agent", "phase1_brand_img", "running", "Generating AI brand images via Gemini").catch(() => {});

    const [logoBuf, heroBuf] = await Promise.allSettled([
      generateImageFromGemini(ai, logoPrompt),
      generateImageFromGemini(ai, heroPrompt),
    ]);

    const logoResult = logoBuf.status === "fulfilled" ? logoBuf.value : null;
    const heroResult = heroBuf.status === "fulfilled" ? heroBuf.value : null;

    if (logoResult) {
      images.push({
        filename: "logo.png",
        storagePath: `${projectId}/brand/logo.png`,
        buffer: logoResult,
        mimeType: "image/png",
        label: "AI Logo Mark",
      });
    }
    if (heroResult) {
      images.push({
        filename: "hero.png",
        storagePath: `${projectId}/brand/hero.png`,
        buffer: heroResult,
        mimeType: "image/png",
        label: "Hero / OG Image",
      });
    }

    await log_task(
      projectId,
      "brand_agent",
      "phase1_brand_img",
      "completed",
      `Generated ${images.length} AI images${images.length < 2 ? " (some fell back to SVG)" : ""}`,
    ).catch(() => {});
  }

  if (!images.find((i) => i.filename === "logo.png")) {
    images.push({
      filename: "logo.svg",
      storagePath: `${projectId}/brand/logo.svg`,
      buffer: generateFallbackLogoSvg(projectName, brandKit.color_palette),
      mimeType: "image/svg+xml",
      label: "Logo Mark",
    });
  }

  if (!images.find((i) => i.filename === "hero.png")) {
    images.push({
      filename: "hero.svg",
      storagePath: `${projectId}/brand/hero.svg`,
      buffer: generateFallbackHeroSvg(projectName, brandKit.color_palette),
      mimeType: "image/svg+xml",
      label: "Hero / OG Image",
    });
  }

  return images;
}

export async function uploadBrandImages(
  projectId: string,
  images: BrandImage[],
  ownerClerkId?: string,
): Promise<string[]> {
  const db = createServiceSupabase();
  const assetIds: string[] = [];

  await Promise.all(
    images.map(async (img) => {
      await withRetry(() =>
        db.storage.from("project-assets").upload(img.storagePath, img.buffer, {
          contentType: img.mimeType,
          upsert: true,
        }),
      );
      const { data: asset } = await withRetry(() =>
        db
          .from("project_assets")
          .insert({
            project_id: projectId,
            phase: 1,
            kind: "upload",
            storage_bucket: "project-assets",
            storage_path: img.storagePath,
            filename: img.filename,
            mime_type: img.mimeType,
            size_bytes: img.buffer.length,
            status: "uploaded",
            metadata: { label: img.label, auto_generated: true, brand_asset: true },
            created_by: ownerClerkId ?? "system",
          })
          .select("id")
          .single(),
      );
      if (asset) assetIds.push(asset.id);
    }),
  );

  return assetIds;
}
