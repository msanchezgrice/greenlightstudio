import { describe, it, expect } from "vitest";
import { onboardingSchema, packetSchema } from "@/types/domain";
import { phase1PacketSchema, phase2PacketSchema, phase3PacketSchema } from "@/types/phase-packets";

describe("domain schemas", () => {
  it("validates onboarding payload", () => {
    const data = onboardingSchema.parse({
      domain: "example.com",
      idea_description: "This is a sufficiently long idea description for validation.",
      repo_url: null,
      runtime_mode: "shared",
      permissions: { repo_write: false, deploy: false, ads_budget_cap: 0, email_send: false },
      night_shift: true,
      focus_areas: ["Product"],
      scan_results: null,
    });
    expect(data.runtime_mode).toBe("shared");
  });

  it("requires packet synopsis", () => {
    expect(() =>
      packetSchema.parse({
        tagline: "t",
        elevator_pitch: "p",
        competitor_analysis: [],
        market_sizing: { tam: "1", sam: "1", som: "1" },
        target_persona: { name: "n", description: "d", pain_points: [] },
        mvp_scope: { in_scope: [], deferred: [] },
        existing_presence: [],
        recommendation: "greenlight",
      }),
    ).toThrow();
  });

  it("validates phase 1 packet payload", () => {
    const data = phase1PacketSchema.parse({
      phase: 1,
      summary: "Phase 1 validation brief for launch-readiness and signal collection.",
      landing_page: {
        headline: "Turn dad-time into screen-free adventures",
        subheadline: "Curated weekly activities with gear, timing, and difficulty hints.",
        primary_cta: "Join the waitlist",
        sections: ["Hero", "Problem", "Solution", "How it works", "FAQ"],
        launch_notes: ["Ship to shared runtime", "Enable analytics from day one"],
      },
      waitlist: {
        capture_stack: "Supabase + Clerk",
        double_opt_in: true,
        form_fields: ["email", "child_age", "city"],
        target_conversion_rate: "8-12%",
      },
      analytics: {
        provider: "PostHog",
        events: ["page_view", "waitlist_submit", "cta_click"],
        dashboard_views: ["Funnel", "By channel"],
      },
      brand_kit: {
        voice: "Helpful, practical, and warm",
        color_palette: ["#22C55E", "#06B6D4", "#0B1220"],
        font_pairing: "Space Grotesk + Source Sans 3",
        logo_prompt: "Minimal mountain icon with bold geometric wordmark",
      },
      social_strategy: {
        channels: ["Instagram", "TikTok"],
        content_pillars: ["Weekend plans", "Dad hacks", "Screen-free wins"],
        posting_cadence: "4 posts/week",
      },
      email_sequence: {
        emails: [
          { day: "Day 0", subject: "Welcome to OfflineDad", goal: "Confirm subscription and set expectations" },
          { day: "Day 2", subject: "Your first 3 adventures", goal: "Deliver immediate value and build trust" },
          { day: "Day 5", subject: "Early access invite", goal: "Drive activation and referrals" },
        ],
      },
      reasoning_synopsis: {
        decision: "greenlight",
        confidence: 78,
        rationale: ["Demand signal is measurable", "Scope is feasible", "Differentiation is clear"],
        risks: ["Audience targeting may be too broad"],
        next_actions: ["Ship landing page", "Run first 14-day acquisition test"],
        evidence: [{ claim: "Competitive gap exists", source: "Phase 0 competitor scan" }],
      },
    });
    expect(data.phase).toBe(1);
  });

  it("validates phase 2 packet payload", () => {
    const data = phase2PacketSchema.parse({
      phase: 2,
      summary: "Distribution plan to convert Phase 1 waitlist signal into repeatable acquisition.",
      distribution_strategy: {
        north_star_metric: "Qualified waitlist signups",
        channel_plan: [
          { channel: "Meta Ads", objective: "Acquire demand", weekly_budget: "$350" },
          { channel: "Email", objective: "Nurture leads", weekly_budget: "$0" },
        ],
      },
      paid_acquisition: {
        enabled: true,
        budget_cap_per_day: 50,
        target_audiences: ["Parents 28-45", "Dad creator followers"],
        creative_angles: ["Screen-free weekend", "Confidence-building activities"],
        kill_switch: "Pause if CPA exceeds $12 for 72h",
      },
      outreach: {
        sequence_type: "Founder-led outreach",
        target_segments: ["Dad communities", "Parenting newsletters"],
        daily_send_cap: 40,
      },
      lifecycle_email: {
        journeys: ["Welcome", "Activation", "Referral"],
        send_window: "8am-6pm local time",
      },
      weekly_experiments: ["Landing headline A/B", "CTA copy test", "Audience split test"],
      guardrails: ["Honor daily budget cap", "Template-only email", "Manual approval for deploy"],
      reasoning_synopsis: {
        decision: "greenlight",
        confidence: 74,
        rationale: ["Channels align with audience", "Controls are in place", "Tracking is configured"],
        risks: ["Ad creative fatigue"],
        next_actions: ["Launch first ad set", "Publish weekly report"],
        evidence: [{ claim: "Organic signal exists", source: "Phase 1 waitlist trend" }],
      },
    });
    expect(data.phase).toBe(2);
  });

  it("validates phase 3 packet payload", () => {
    const data = phase3PacketSchema.parse({
      phase: 3,
      summary: "Go-live plan for production rollout with controlled risk and rollback.",
      architecture_review: {
        runtime_mode: "attached",
        system_components: ["Next.js app", "Supabase", "Clerk"],
        critical_dependencies: ["Anthropic API", "Vercel"],
      },
      build_plan: {
        milestones: [
          { name: "Harden auth", owner: "engineering", exit_criteria: "All protected routes verified" },
          { name: "Release candidate", owner: "engineering", exit_criteria: "E2E suite passes on preview" },
          { name: "Production launch", owner: "ceo_agent", exit_criteria: "Launch gate approved in inbox" },
        ],
      },
      qa_plan: {
        test_suites: ["Unit", "Integration", "E2E"],
        acceptance_gates: ["No P1 bugs", "Metrics baseline present", "Rollback tested"],
      },
      launch_checklist: ["Tag release", "Run migrations", "Deploy", "Smoke test"],
      rollback_plan: {
        triggers: ["Error budget exceeded", "Conversion drop > 30%"],
        steps: ["Freeze deploys", "Rollback release", "Verify stability"],
      },
      merge_policy: {
        review_required: true,
        approvals_required: 2,
        protected_branch: "main",
      },
      operational_readiness: ["Runbook written", "Alerting configured", "Owner on-call"],
      reasoning_synopsis: {
        decision: "greenlight",
        confidence: 81,
        rationale: ["Release gates are explicit", "Rollback path is clear", "Test coverage is sufficient"],
        risks: ["Dependency outages"],
        next_actions: ["Run final launch checklist", "Monitor first 24h"],
        evidence: [{ claim: "All gates covered", source: "Phase 3 readiness review" }],
      },
    });
    expect(data.phase).toBe(3);
  });
});
