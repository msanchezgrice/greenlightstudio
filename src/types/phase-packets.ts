import { z } from "zod";
import { packetSchema, reasoningSynopsisSchema } from "@/types/domain";

export const phase0PacketSchema = packetSchema;

export const phase1PacketSchema = z.object({
  phase: z.literal(1).optional(),
  summary: z.string().min(20),
  landing_page: z.object({
    headline: z.string().min(8),
    subheadline: z.string().min(8),
    primary_cta: z.string().min(3),
    sections: z.array(z.string()).min(3),
    launch_notes: z.array(z.string()).min(2),
  }),
  waitlist: z.object({
    capture_stack: z.string().min(2),
    double_opt_in: z.boolean(),
    form_fields: z.array(z.string()).min(2),
    target_conversion_rate: z.string().min(2),
  }),
  analytics: z.object({
    provider: z.string().min(2),
    events: z.array(z.string()).min(3),
    dashboard_views: z.array(z.string()).min(2),
  }),
  brand_kit: z.object({
    voice: z.string().min(4),
    color_palette: z.array(z.string()).min(3),
    font_pairing: z.string().min(3),
    logo_prompt: z.string().min(8),
  }),
  social_strategy: z.object({
    channels: z.array(z.string()).min(2),
    content_pillars: z.array(z.string()).min(3),
    posting_cadence: z.string().min(2),
  }),
  email_sequence: z.object({
    emails: z
      .array(
        z.object({
          day: z.string().min(1),
          subject: z.string().min(3),
          goal: z.string().min(8),
        }),
      )
      .min(3),
  }),
  reasoning_synopsis: reasoningSynopsisSchema,
});

export const phase2PacketSchema = z.object({
  phase: z.literal(2).optional(),
  summary: z.string().min(20),
  distribution_strategy: z.object({
    north_star_metric: z.string().min(3),
    channel_plan: z
      .array(
        z.object({
          channel: z.string().min(2),
          objective: z.string().min(4),
          weekly_budget: z.string().min(1),
        }),
      )
      .min(2),
  }),
  paid_acquisition: z.object({
    enabled: z.boolean(),
    budget_cap_per_day: z.number().min(0),
    target_audiences: z.array(z.string()).min(1),
    creative_angles: z.array(z.string()).min(2),
    kill_switch: z.string().min(6),
  }),
  outreach: z.object({
    sequence_type: z.string().min(3),
    target_segments: z.array(z.string()).min(1),
    daily_send_cap: z.number().int().min(0),
  }),
  lifecycle_email: z.object({
    journeys: z.array(z.string()).min(2),
    send_window: z.string().min(3),
  }),
  weekly_experiments: z.array(z.string()).min(3),
  guardrails: z.array(z.string()).min(3),
  reasoning_synopsis: reasoningSynopsisSchema,
});

export const phase3PacketSchema = z.object({
  phase: z.literal(3).optional(),
  summary: z.string().min(20),
  architecture_review: z.object({
    runtime_mode: z.enum(["shared", "attached"]),
    system_components: z.array(z.string()).min(3),
    critical_dependencies: z.array(z.string()).min(2),
  }),
  build_plan: z.object({
    milestones: z
      .array(
        z.object({
          name: z.string().min(3),
          owner: z.string().min(2),
          exit_criteria: z.string().min(8),
        }),
      )
      .min(3),
  }),
  qa_plan: z.object({
    test_suites: z.array(z.string()).min(3),
    acceptance_gates: z.array(z.string()).min(3),
  }),
  launch_checklist: z.array(z.string()).min(4),
  rollback_plan: z.object({
    triggers: z.array(z.string()).min(2),
    steps: z.array(z.string()).min(3),
  }),
  merge_policy: z.object({
    review_required: z.boolean(),
    approvals_required: z.number().int().min(1),
    protected_branch: z.string().min(2),
  }),
  operational_readiness: z.array(z.string()).min(3),
  reasoning_synopsis: reasoningSynopsisSchema,
});

export const phasePacketSchemaById = {
  0: phase0PacketSchema,
  1: phase1PacketSchema,
  2: phase2PacketSchema,
  3: phase3PacketSchema,
} as const;

export type Phase0Packet = z.infer<typeof phase0PacketSchema>;
export type Phase1Packet = z.infer<typeof phase1PacketSchema>;
export type Phase2Packet = z.infer<typeof phase2PacketSchema>;
export type Phase3Packet = z.infer<typeof phase3PacketSchema>;

export type PhasePacket = Phase0Packet | Phase1Packet | Phase2Packet | Phase3Packet;

export function parsePhasePacket(phase: number, payload: unknown): PhasePacket {
  if (phase === 0) return phase0PacketSchema.parse(payload);
  if (phase === 1) return phase1PacketSchema.parse(payload);
  if (phase === 2) return phase2PacketSchema.parse(payload);
  if (phase === 3) return phase3PacketSchema.parse(payload);
  throw new Error(`Unsupported phase ${phase}`);
}
