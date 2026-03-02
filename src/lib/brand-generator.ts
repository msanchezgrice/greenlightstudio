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
  phase?: number;
};

type BrandImageTemplate = {
  filename: string;
  label: string;
  objective: string;
  rendering: string;
};

type BrandGenerationOptions = {
  phase?: number;
  summary?: string | null;
  variant?: "brand" | "marketing";
};

type BrandUploadOptions = {
  phase?: number;
  metadata?: Record<string, unknown>;
};

const NANOBANANA_CANONICAL_MODEL = "gemini-3-pro-image-preview";
const NANOBANANA_MODEL_ALIASES: Record<string, string> = {
  "gemini-3-pro-image-preview": NANOBANANA_CANONICAL_MODEL,
  "nano-banana-pro-preview": NANOBANANA_CANONICAL_MODEL,
  "nanobanana-pro-preview": NANOBANANA_CANONICAL_MODEL,
  "nanobanana-pro-2": NANOBANANA_CANONICAL_MODEL,
  "nano-banana-pro-2": NANOBANANA_CANONICAL_MODEL,
  "nanobanana-pro": NANOBANANA_CANONICAL_MODEL,
};

function resolveNanobananaModel(): string {
  const requestedRaw =
    process.env.NANOBANANA_MODEL?.trim() ||
    process.env.GEMINI_IMAGE_MODEL?.trim() ||
    NANOBANANA_CANONICAL_MODEL;
  const requestedKey = requestedRaw.toLowerCase();
  const resolved = NANOBANANA_MODEL_ALIASES[requestedKey] ?? requestedRaw;
  if (resolved !== NANOBANANA_CANONICAL_MODEL) {
    throw new Error(
      `Brand image generation is locked to ${NANOBANANA_CANONICAL_MODEL}; requested model "${requestedRaw}" is not allowed`,
    );
  }
  return resolved;
}

function getGeminiClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY?.trim() || process.env.NANOBANANA_GEMINI_API_KEY?.trim();
  if (!key) {
    throw new Error("Brand image generation requires GEMINI_API_KEY or NANOBANANA_GEMINI_API_KEY");
  }
  return new GoogleGenAI({ apiKey: key });
}

async function generateImageFromGemini(ai: GoogleGenAI, model: string, prompt: string, label: string): Promise<Buffer> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseModalities: ["TEXT", "IMAGE"],
        },
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find((part) => typeof part.inlineData?.data === "string");
      const image = imagePart?.inlineData?.data;
      if (!image || typeof image !== "string") {
        throw new Error(`${label}: model returned no image bytes`);
      }

      return Buffer.from(image, "base64");
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(`${label}: unknown image generation failure`);
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
      }
    }
  }

  throw new Error(lastError?.message ?? `${label}: image generation failed`);
}

export async function generateBrandImages(
  projectId: string,
  projectName: string,
  brandKit: BrandKit,
  options: BrandGenerationOptions = {},
): Promise<BrandImage[]> {
  const phase = Number.isFinite(options.phase) ? Number(options.phase) : 1;
  const variant = options.variant ?? "brand";
  const taskPrefix = `phase${Math.max(0, phase)}`;
  const model = resolveNanobananaModel();
  const ai = getGeminiClient();

  await log_task(
    projectId,
    "brand_agent",
    `${taskPrefix}_brand_img`,
    "running",
    `Generating brand images via Gemini model ${model}`,
  ).catch(() => {});

  try {
    const templates: BrandImageTemplate[] =
      variant === "marketing"
        ? [
            {
              filename: "social-square.png",
              label: "Social Square Creative",
              objective: "Generate a high-performing social creative for demand capture.",
              rendering: "Aspect ratio 1080x1080. Keep visual hierarchy strong. No tiny unreadable elements.",
            },
            {
              filename: "social-story.png",
              label: "Social Story Creative",
              objective: "Generate a vertical social story creative for swipe-up traffic.",
              rendering: "Aspect ratio 1080x1920. Bold composition. Keep safe margins around edges.",
            },
            {
              filename: "social-landscape.png",
              label: "Social Landscape Creative",
              objective: "Generate a 16:9 promotional creative for sponsored content.",
              rendering: "Aspect ratio 1920x1080. Dramatic contrast. No logo watermark overlays.",
            },
          ]
        : [
            {
              filename: "logo.png",
              label: "AI Logo Mark",
              objective: "Create the primary logo mark.",
              rendering: "Transparent background. Centered mark. No extra text. Crisp edges.",
            },
            {
              filename: "logo-inverse.png",
              label: "Logo Inverse Treatment",
              objective: "Create an alternate inverted logo treatment for dark surfaces.",
              rendering: "Transparent background with high-contrast mark. No extra text.",
            },
            {
              filename: "hero.png",
              label: "Hero / OG Image",
              objective: "Create a hero visual used for landing page and Open Graph previews.",
              rendering: "Aspect ratio 1200x630. Cinematic composition. No text overlays.",
            },
            {
              filename: "website-feature.png",
              label: "Website Feature Visual",
              objective: "Create a feature section visual for the landing page body.",
              rendering: "Aspect ratio 1600x900. Product-focused composition. No text overlays.",
            },
            {
              filename: "website-product.png",
              label: "Website Product Illustration",
              objective: "Create a supporting product illustration for trust/value sections.",
              rendering: "Aspect ratio 1600x900. Consistent palette and style.",
            },
            {
              filename: "social-square.png",
              label: "Social Square Creative",
              objective: "Create a social launch post visual.",
              rendering: "Aspect ratio 1080x1080. Crisp focal point. No text overlays.",
            },
            {
              filename: "social-story.png",
              label: "Social Story Creative",
              objective: "Create a vertical social story visual.",
              rendering: "Aspect ratio 1080x1920. Bold contrast and fast readability.",
            },
          ];

    const summaryLine = options.summary?.trim()
      ? `Product context: ${options.summary.trim().slice(0, 280)}.`
      : "";

    const images: BrandImage[] = [];
    for (const template of templates) {
      const prompt = [
        `Project: "${projectName}".`,
        `Objective: ${template.objective}`,
        `Logo direction: ${brandKit.logo_prompt}.`,
        `Brand voice: ${brandKit.voice}.`,
        `Palette: ${brandKit.color_palette.join(", ")}.`,
        `Font direction reference: ${brandKit.font_pairing}.`,
        summaryLine,
        template.rendering,
        "Style should be premium, specific, and production-ready.",
        "Avoid generic stock-photo look. Keep the composition intentional and bold.",
      ]
        .filter((line) => line.trim().length > 0)
        .join(" ");
      const buffer = await generateImageFromGemini(ai, model, prompt, template.label);
      images.push({
        filename: template.filename,
        storagePath: `${projectId}/brand/${template.filename}`,
        buffer,
        mimeType: "image/png",
        label: template.label,
        phase,
      });
    }

    await log_task(
      projectId,
      "brand_agent",
      `${taskPrefix}_brand_img`,
      "completed",
      `Generated ${images.length} brand images with ${model}`,
    ).catch(() => {});

    return images;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Brand image generation failed";
    await log_task(projectId, "brand_agent", `${taskPrefix}_brand_img`, "failed", detail).catch(() => {});
    throw error;
  }
}

export async function uploadBrandImages(
  projectId: string,
  images: BrandImage[],
  ownerClerkId?: string,
  options: BrandUploadOptions = {},
): Promise<string[]> {
  const db = createServiceSupabase();
  const assetIds: string[] = [];
  const phase = Number.isFinite(options.phase) ? Number(options.phase) : 1;
  const sharedMetadata = options.metadata ?? {};

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
            phase,
            kind: "upload",
            storage_bucket: "project-assets",
            storage_path: img.storagePath,
            filename: img.filename,
            mime_type: img.mimeType,
            size_bytes: img.buffer.length,
            status: "uploaded",
            metadata: {
              label: img.label,
              auto_generated: true,
              brand_asset: true,
              phase,
              ...sharedMetadata,
            },
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
