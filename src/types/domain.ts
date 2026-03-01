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

export const competitorSchema = z.object({
  name: z.string(),
  url: z.string().url().optional(),
  snippet: z.string().optional(),
});

export const repoSummarySchema = z.object({
  provider: z.enum(["github", "gitlab"]).nullable().optional(),
  repo: z.string().nullable().optional(),
  framework: z.string().nullable(),
  language: z.string().nullable(),
  loc: z.number().int().min(0).nullable(),
  last_commit: z.string().nullable(),
  key_files: z.array(z.string()),
  error: z.string().optional(),
});

export const scanResultSchema = z.object({
  domain: z.string().nullable().optional(),
  dns: z.enum(["live", "parked", "none"]).nullable(),
  http_status: z.number().nullable(),
  tech_stack: z.array(z.string()).nullable(),
  meta: z.object({ title: z.string().nullable(), desc: z.string().nullable(), og_image: z.string().nullable() }).nullable(),
  existing_content: z.enum(["site", "parked", "none"]),
  repo_summary: repoSummarySchema.nullable().optional(),
  competitors_found: z.array(competitorSchema),
  error: z.string().optional(),
});

export const onboardingSchema = z.object({
  domain: z.string().optional().nullable(),
  domains: z.array(z.string()).max(10).optional().default([]),
  idea_description: z.string().trim().max(2000).optional().default(""),
  app_description: z.string().trim().max(2000).optional().default(""),
  value_prop: z.string().trim().max(1200).optional().default(""),
  mission: z.string().trim().max(1200).optional().default(""),
  target_demo: z.string().trim().max(1200).optional().default(""),
  demo_url: z.string().url().optional().nullable(),
  repo_url: z.string().url().optional().nullable(),
  uploaded_files: z
    .array(
      z.object({
        name: z.string(),
        size: z.number().int().min(0),
        type: z.string(),
        last_modified: z.number().int().optional(),
      }),
    )
    .max(5)
    .optional()
    .default([]),
  runtime_mode: z.enum(["shared", "attached"]),
  permissions: z.object({
    repo_write: z.boolean(),
    deploy: z.boolean(),
    ads_budget_cap: z.number().min(0),
    ads_enabled: z.boolean().optional().default(false),
    email_send: z.boolean(),
  }),
  night_shift: z.boolean(),
  focus_areas: z.array(z.string()).min(1),
  scan_results: scanResultSchema.nullable(),
});

export const projectAssetSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  mime_type: z.string(),
  size_bytes: z.number().int().min(0),
  status: z.string(),
  storage_path: z.string(),
});

export type ProjectAsset = z.infer<typeof projectAssetSchema>;

export const deliverableSchema = z.object({
  kind: z.string(),
  label: z.string(),
  url: z.string().nullable(),
  storage_path: z.string().nullable(),
  status: z.enum(['pending', 'generated', 'stored', 'failed']),
  generated_at: z.string().nullable(),
});

export type Deliverable = z.infer<typeof deliverableSchema>;

export type Packet = z.infer<typeof packetSchema>;
export type OnboardingInput = z.infer<typeof onboardingSchema>;
export type ScanResult = z.infer<typeof scanResultSchema>;
export type RepoSummary = z.infer<typeof repoSummarySchema>;
