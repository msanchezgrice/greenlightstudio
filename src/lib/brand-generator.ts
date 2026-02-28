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

const NANOBANANA_MODEL = "nanobanana-pro-2";

function validateModelOverride(): void {
  const requested =
    process.env.NANOBANANA_MODEL?.trim() ||
    process.env.GEMINI_IMAGE_MODEL?.trim() ||
    NANOBANANA_MODEL;
  if (requested !== NANOBANANA_MODEL) {
    throw new Error(
      `Brand image generation is locked to ${NANOBANANA_MODEL}; requested model "${requested}" is not allowed`,
    );
  }
}

function getGeminiClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY?.trim() || process.env.NANOBANANA_GEMINI_API_KEY?.trim();
  if (!key) {
    throw new Error("Brand image generation requires GEMINI_API_KEY or NANOBANANA_GEMINI_API_KEY");
  }
  return new GoogleGenAI({ apiKey: key });
}

async function generateImageFromGemini(ai: GoogleGenAI, prompt: string, label: string): Promise<Buffer> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await ai.models.generateImages({
        model: NANOBANANA_MODEL,
        prompt,
        config: { numberOfImages: 1 },
      });

      const image = response.generatedImages?.[0]?.image?.imageBytes;
      if (!image) {
        throw new Error(`${label}: model returned no image bytes`);
      }

      return Buffer.from(image, "base64");
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(`${label}: unknown image generation failure`);
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
      }
    }
  }

  throw new Error(lastError?.message ?? `${label}: image generation failed`);
}

export async function generateBrandImages(
  projectId: string,
  projectName: string,
  brandKit: BrandKit,
): Promise<BrandImage[]> {
  validateModelOverride();
  const ai = getGeminiClient();

  await log_task(
    projectId,
    "brand_agent",
    "phase1_brand_img",
    "running",
    `Generating brand images via Gemini model ${NANOBANANA_MODEL}`,
  ).catch(() => {});

  try {
    const logoPrompt = [
      `Create a premium brand logo for "${projectName}".`,
      `Direction: ${brandKit.logo_prompt}.`,
      `Brand voice: ${brandKit.voice}.`,
      `Palette: ${brandKit.color_palette.join(", ")}.`,
      "Output requirements: transparent background, centered mark, no surrounding whitespace, no extra text, crisp edges.",
      "Style: modern, iconic, scalable from favicon to billboard.",
    ].join(" ");

    const heroPrompt = [
      `Create a premium hero visual for "${projectName}".`,
      `Brand voice: ${brandKit.voice}.`,
      `Palette: ${brandKit.color_palette.join(", ")}.`,
      "Aspect ratio 1200x630, cinematic composition, high contrast focal point, no text.",
      "Style should feel production-ready for landing page and Open Graph card.",
    ].join(" ");

    const [logoBuffer, heroBuffer] = await Promise.all([
      generateImageFromGemini(ai, logoPrompt, "logo"),
      generateImageFromGemini(ai, heroPrompt, "hero"),
    ]);

    const images: BrandImage[] = [
      {
        filename: "logo.png",
        storagePath: `${projectId}/brand/logo.png`,
        buffer: logoBuffer,
        mimeType: "image/png",
        label: "AI Logo Mark",
      },
      {
        filename: "hero.png",
        storagePath: `${projectId}/brand/hero.png`,
        buffer: heroBuffer,
        mimeType: "image/png",
        label: "Hero / OG Image",
      },
    ];

    await log_task(
      projectId,
      "brand_agent",
      "phase1_brand_img",
      "completed",
      `Generated ${images.length} brand images with ${NANOBANANA_MODEL}`,
    ).catch(() => {});

    return images;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Brand image generation failed";
    await log_task(projectId, "brand_agent", "phase1_brand_img", "failed", detail).catch(() => {});
    throw error;
  }
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
