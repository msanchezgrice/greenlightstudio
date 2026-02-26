import { describe, it, expect } from "vitest";
import { deriveNightShiftActions } from "@/lib/nightshift";
import { phase1PacketSchema, phase2PacketSchema, phase3PacketSchema } from "@/types/phase-packets";

describe("nightshift action derivation", () => {
  it("maps phase 1 next actions to deploy + welcome email approvals", () => {
    const packet = phase1PacketSchema.parse({
      phase: 1,
      summary: "Phase 1 validation packet summary with concrete launch plan.",
      landing_page: {
        headline: "Build confidence for first-time dad adventures",
        subheadline: "A curated weekly plan with equipment and timing guidance.",
        primary_cta: "Join the waitlist",
        sections: ["Problem", "Solution", "Proof", "FAQ"],
        launch_notes: ["Publish now", "Track conversion events"],
      },
      waitlist: {
        capture_stack: "Supabase + Clerk",
        double_opt_in: true,
        form_fields: ["email", "child_age"],
        target_conversion_rate: "10%",
      },
      analytics: {
        provider: "PostHog",
        events: ["page_view", "cta_click", "waitlist_submit"],
        dashboard_views: ["Funnel", "Channel Breakdown"],
      },
      brand_kit: {
        voice: "Clear and practical",
        color_palette: ["#22C55E", "#06B6D4", "#0B1220"],
        font_pairing: "Space Grotesk + Inter",
        logo_prompt: "Simple geometric mark with mountain profile",
      },
      social_strategy: {
        channels: ["Instagram", "TikTok"],
        content_pillars: ["Routines", "Gear", "Mindset"],
        posting_cadence: "4 posts/week",
      },
      email_sequence: {
        emails: [
          { day: "Day 0", subject: "Welcome", goal: "Confirm and onboard." },
          { day: "Day 2", subject: "Top 3 plans", goal: "Drive activation." },
          { day: "Day 5", subject: "Invite friends", goal: "Increase referrals." },
        ],
      },
      reasoning_synopsis: {
        decision: "greenlight",
        confidence: 80,
        rationale: ["Strong pain point", "Clear scope", "Fast to test"],
        risks: ["Creative fatigue"],
        next_actions: [
          "Deploy the landing page to shared runtime tonight",
          "Send the welcome email sequence to all new leads",
        ],
        evidence: [{ claim: "Demand signal exists", source: "Phase 0 packet" }],
      },
    });

    const actions = deriveNightShiftActions({
      phase: 1,
      packet,
      runtimeMode: "shared",
      repoUrl: null,
      permissions: { email_send: true, deploy: false },
    });

    expect(actions.some((action) => action.approval?.action_type === "deploy_landing_page")).toBe(true);
    expect(actions.some((action) => action.approval?.action_type === "send_welcome_email_sequence")).toBe(true);
  });

  it("maps phase 2 next actions to ads and lifecycle email approvals", () => {
    const packet = phase2PacketSchema.parse({
      phase: 2,
      summary: "Phase 2 packet focused on repeatable acquisition loops.",
      distribution_strategy: {
        north_star_metric: "Qualified waitlist signups",
        channel_plan: [
          { channel: "Meta Ads", objective: "Acquire traffic", weekly_budget: "$350" },
          { channel: "Email", objective: "Nurture and convert", weekly_budget: "$0" },
        ],
      },
      paid_acquisition: {
        enabled: true,
        budget_cap_per_day: 50,
        target_audiences: ["Parents 28-45"],
        creative_angles: ["Screen-free wins", "Weekend adventure kits"],
        kill_switch: "Pause if CPA > $15 for 3 days",
      },
      outreach: {
        sequence_type: "Founder-led",
        target_segments: ["Communities"],
        daily_send_cap: 25,
      },
      lifecycle_email: {
        journeys: ["Welcome", "Activation"],
        send_window: "8am-6pm",
      },
      weekly_experiments: ["Headline test", "Audience split", "CTA test"],
      guardrails: ["Cap spend", "Manual approval", "Daily review"],
      reasoning_synopsis: {
        decision: "greenlight",
        confidence: 75,
        rationale: ["Good intent data", "Trackable funnel", "Reasonable CAC assumptions"],
        risks: ["Rising CPM"],
        next_actions: ["Activate meta ads campaign with budget cap", "Send lifecycle email to converted users"],
        evidence: [{ claim: "Early intent is positive", source: "Phase 1 results" }],
      },
    });

    const actions = deriveNightShiftActions({
      phase: 2,
      packet,
      runtimeMode: "attached",
      repoUrl: "https://github.com/acme/project",
      permissions: { ads_enabled: true, ads_budget_cap: 50, email_send: true },
    });

    expect(actions.some((action) => action.approval?.action_type === "activate_meta_ads_campaign")).toBe(true);
    expect(actions.some((action) => action.approval?.action_type === "send_phase2_lifecycle_email")).toBe(true);
  });

  it("maps phase 3 next actions to repo workflow and deploy approvals", () => {
    const packet = phase3PacketSchema.parse({
      phase: 3,
      summary: "Phase 3 packet with hard launch controls and rollback.",
      architecture_review: {
        runtime_mode: "attached",
        system_components: ["Next.js", "Supabase", "Clerk"],
        critical_dependencies: ["Anthropic", "Vercel"],
      },
      build_plan: {
        milestones: [
          { name: "RC build", owner: "engineering", exit_criteria: "All tests passing on preview" },
          { name: "Launch prep", owner: "ceo_agent", exit_criteria: "Gate approved in inbox" },
          { name: "Go-live", owner: "engineering", exit_criteria: "Smoke tests green in production" },
        ],
      },
      qa_plan: {
        test_suites: ["Unit", "Integration", "E2E"],
        acceptance_gates: ["No P1 defects", "Core funnel healthy", "Rollback verified"],
      },
      launch_checklist: ["Tag release", "Apply migrations", "Deploy", "Smoke test"],
      rollback_plan: {
        triggers: ["Error budget breach", "Conversion drop > 25%"],
        steps: ["Freeze deploys", "Rollback", "Re-verify"],
      },
      merge_policy: {
        review_required: true,
        approvals_required: 2,
        protected_branch: "main",
      },
      operational_readiness: ["Runbook ready", "Alerting configured", "On-call assigned"],
      reasoning_synopsis: {
        decision: "greenlight",
        confidence: 83,
        rationale: ["Clear release gates", "Rollback path exists", "Operational readiness confirmed"],
        risks: ["Dependency outage"],
        next_actions: ["Trigger repo workflow for release branch", "Trigger production deploy after gate"],
        evidence: [{ claim: "Launch checklist complete", source: "Phase 3 review" }],
      },
    });

    const actions = deriveNightShiftActions({
      phase: 3,
      packet,
      runtimeMode: "attached",
      repoUrl: "https://github.com/acme/project",
      permissions: { repo_write: true, deploy: true },
    });

    expect(actions.some((action) => action.approval?.action_type === "trigger_phase3_repo_workflow")).toBe(true);
    expect(actions.some((action) => action.approval?.action_type === "trigger_phase3_deploy")).toBe(true);
  });
});

