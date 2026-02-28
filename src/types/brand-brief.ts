import { z } from "zod";

const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#?[0-9a-fA-F]{6}$/, "Expected 6-digit hex color");

export const brandBriefSlideLayoutSchema = z.enum([
  "statement",
  "split_image_left",
  "split_image_right",
  "full_image",
  "grid",
  "rules",
  "spotlight",
]);

export const brandBriefSlideKindSchema = z.enum([
  "cover",
  "positioning",
  "logo_system",
  "palette",
  "typography",
  "imagery",
  "voice",
  "guidelines",
  "closing",
]);

export const brandBriefSlideSchema = z.object({
  kind: brandBriefSlideKindSchema,
  layout: brandBriefSlideLayoutSchema,
  kicker: z.string().trim().min(2).max(80),
  title: z.string().trim().min(8).max(140),
  subtitle: z.string().trim().max(220).optional().nullable(),
  body: z.string().trim().max(700).optional().nullable(),
  bullets: z.array(z.string().trim().min(4).max(180)).max(7).default([]),
  do: z.array(z.string().trim().min(4).max(140)).max(6).optional().default([]),
  dont: z.array(z.string().trim().min(4).max(140)).max(6).optional().default([]),
  image_key: z.enum(["logo", "hero"]).optional().nullable(),
  palette_focus: z.array(hexColorSchema).max(6).optional().default([]),
});

export const brandBriefDeckSpecSchema = z
  .object({
    visual_direction: z.string().trim().min(12).max(260),
    narrative: z.string().trim().min(40).max(700),
    typography: z.object({
      heading_font: z.string().trim().min(2).max(80),
      body_font: z.string().trim().min(2).max(80),
    }),
    style_tokens: z.object({
      background: hexColorSchema,
      surface: hexColorSchema,
      text: hexColorSchema,
      muted_text: hexColorSchema,
      accent: hexColorSchema,
      accent_secondary: hexColorSchema,
    }),
    slides: z.array(brandBriefSlideSchema).min(6).max(10),
  })
  .superRefine((value, ctx) => {
    const hasCover = value.slides.some((slide) => slide.kind === "cover");
    const hasPalette = value.slides.some((slide) => slide.kind === "palette");
    const hasGuidelines = value.slides.some((slide) => slide.kind === "guidelines");
    const hasClosing = value.slides.some((slide) => slide.kind === "closing");

    if (!hasCover) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slides"],
        message: "Deck must include one cover slide.",
      });
    }
    if (!hasPalette) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slides"],
        message: "Deck must include one palette slide.",
      });
    }
    if (!hasGuidelines) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slides"],
        message: "Deck must include one guidelines slide.",
      });
    }
    if (!hasClosing) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slides"],
        message: "Deck must include one closing slide.",
      });
    }

    value.slides.forEach((slide, index) => {
      if (slide.kind === "palette" && slide.palette_focus.length < 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slides", index, "palette_focus"],
          message: "Palette slide must include at least three colors.",
        });
      }
      if (slide.kind === "guidelines" && (slide.do.length < 3 || slide.dont.length < 3)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slides", index],
          message: "Guidelines slide must include at least three Do and three Don't rules.",
        });
      }
      if ((slide.kind === "logo_system" || slide.kind === "imagery") && !slide.image_key) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slides", index, "image_key"],
          message: "Logo and imagery slides must include image_key.",
        });
      }
    });
  });

export type BrandBriefDeckSpec = z.infer<typeof brandBriefDeckSpecSchema>;
export type BrandBriefSlide = z.infer<typeof brandBriefSlideSchema>;
