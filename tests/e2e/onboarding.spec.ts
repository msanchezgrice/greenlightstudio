import { test, expect } from "@playwright/test";

test("onboarding progresses from import to confirm", async ({ page }) => {
  await page.goto("/onboarding?new=1");

  await expect(page.getByRole("heading", { name: "Start with what you already have" })).toBeVisible();
  await page.getByRole("button", { name: "Just an idea One sentence is enough to generate the first founder brief." }).click();
  await page.getByPlaceholder("AI workflow copilot for boutique agencies that turns client requests into scoped tasks, timelines, and margin-aware estimates.").fill(
    "A platform that helps parents plan screen-free family activities with clear time, budget, and location filters.",
  );

  await page.getByRole("button", { name: "Generate Instant Brief →" }).click();
  await expect(page.getByRole("heading", { name: "Your Instant Founder Brief" })).toBeVisible();

  await page.getByRole("button", { name: "Continue to launch review →" }).click();
  await expect(page.getByRole("heading", { name: "Ready to launch?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Launch Full Phase 0 →" })).toBeDisabled();
});

test("onboarding allows domain-only multi-project setup without idea description", async ({ page }) => {
  await page.goto("/onboarding?new=1");

  await expect(page.getByRole("heading", { name: "Start with what you already have" })).toBeVisible();
  await page.getByRole("button", { name: "A domain We will scan the live or parked site in read-only mode." }).click();
  await page.getByPlaceholder("offlinedad.com, offlinedad.app").fill("alpha.example.com, beta.example.com");

  await page.getByRole("button", { name: "Continue without scan →" }).click();
  await expect(page.getByRole("heading", { name: "Your Instant Founder Brief" })).toBeVisible();

  await page.getByRole("button", { name: "Continue to launch review →" }).click();
  await expect(page.getByRole("heading", { name: "Ready to launch?" })).toBeVisible();
  await expect(page.getByText("We will create 2 projects (one per domain).")).toBeVisible();
  await expect(page.getByRole("button", { name: "Launch Full Phase 0 →" })).toBeDisabled();
});

test("onboarding new session clears persisted wizard state", async ({ page }) => {
  await page.goto("/onboarding");

  await page.evaluate(() => {
    const stored = {
      step: "confirm",
      projectId: "persisted-project",
      cacheHit: true,
      form: {
        domain: "persisted.com",
        idea_description: "A persisted idea description that should be cleared when new=1 is used.",
        repo_url: "",
        uploaded_files: [],
        runtime_mode: "attached",
        permissions: {
          repo_write: true,
          deploy: true,
          ads_enabled: false,
          ads_budget_cap: 0,
          email_send: true,
        },
        night_shift: false,
        focus_areas: ["Market Research"],
        scan_results: null,
      },
    };

    localStorage.setItem("greenlight_onboarding_wizard_v1", JSON.stringify(stored));
    sessionStorage.setItem("greenlight_onboarding_wizard_v1_session", JSON.stringify(stored));
  });

  await page.goto("/onboarding?new=1");
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Start with what you already have" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ready to launch?" })).toHaveCount(0);
});
