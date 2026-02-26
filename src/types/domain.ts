import { z } from "zod";

export const reasoningSynopsisSchema = z.object({
  decision: z.enum(["greenlight", "revise", "kill"]),
  confidence: z.number().int().min(0).max(100),
  rationale: z.array(z.string()).min(3),
  risks: z.array(z.string()),
  next_actions: z.array(z.string()),
  evidence: z.array(
    z.object({
      claim: z.string(),
      source: z.string(),
    }),
  ),
});

export const packetSchema = z.object({
  tagline: z.string(),
  elevator_pitch: z.string(),
  confidence_breakdown: z
    .object({
      market: z.number().int().min(0).max(100),
      competition: z.number().int().min(0).max(100),
      feasibility: z.number().int().min(0).max(100),
      timing: z.number().int().min(0).max(100),
    })
    .optional(),
  competitor_analysis: z.array(
    z.object({
      name: z.string(),
      positioning: z.string(),
      gap: z.string(),
      pricing: z.string(),
    }),
  ),
  market_sizing: z.object({ tam: z.string(), sam: z.string(), som: z.string() }),
  target_persona: z.object({
    name: z.string(),
    description: z.string(),
    pain_points: z.array(z.string()),
  }),
  mvp_scope: z.object({ in_scope: z.array(z.string()), deferred: z.array(z.string()) }),
  existing_presence: z.array(
    z.object({ domain: z.string(), status: z.string(), detail: z.string(), scanned_at: z.string() }),
  ),
  recommendation: z.enum(["greenlight", "revise", "kill"]),
  reasoning_synopsis: reasoningSynopsisSchema,
});

export const scanResultSchema = z.object({
  dns: z.enum(["live", "parked", "none"]).nullable(),
  http_status: z.number().nullable(),
  tech_stack: z.array(z.string()).nullable(),
  meta: z.object({ title: z.string().nullable(), desc: z.string().nullable(), og_image: z.string().nullable() }).nullable(),
  existing_content: z.enum(["site", "parked", "none"]),
  competitors_found: z.array(z.object({ name: z.string(), url: z.string().optional() })),
  error: z.string().optional(),
});

export const onboardingSchema = z.object({
  domain: z.string().optional().nullable(),
  idea_description: z.string().min(20),
  repo_url: z.string().url().optional().nullable(),
  runtime_mode: z.enum(["shared", "attached"]),
  permissions: z.object({
    repo_write: z.boolean(),
    deploy: z.boolean(),
    ads_budget_cap: z.number().min(0),
    email_send: z.boolean(),
  }),
  night_shift: z.boolean(),
  focus_areas: z.array(z.string()).min(1),
  scan_results: scanResultSchema.nullable(),
});

export type Packet = z.infer<typeof packetSchema>;
export type OnboardingInput = z.infer<typeof onboardingSchema>;
export type ScanResult = z.infer<typeof scanResultSchema>;
