import { describe, it, expect } from "vitest";
import { onboardingSchema, packetSchema } from "@/types/domain";

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
});
