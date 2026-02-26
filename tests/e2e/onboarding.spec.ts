import { test, expect } from "@playwright/test";

test("onboarding progresses from import to confirm", async ({ page }) => {
  await page.goto("/onboarding?new=1");

  await expect(page.getByRole("heading", { name: "What are you building?" })).toBeVisible();
  await page.getByPlaceholder("offlinedad.com, offlinedad.app").fill("offlinedad.com, offlinedad.app");
  await page.getByPlaceholder("Parenting app for dads who want to disconnect from screens and be more present with their kids...").fill(
    "A platform that helps parents plan screen-free family activities with clear time, budget, and location filters.",
  );

  await page.getByRole("button", { name: "Skip scan, go to settings →" }).click();
  await expect(page.getByRole("heading", { name: "How should we operate?" })).toBeVisible();

  await page.getByRole("button", { name: "Review & Launch →" }).click();
  await expect(page.getByRole("heading", { name: "Ready to launch?" })).toBeVisible();
  await expect(page.getByText("offlinedad.com (+1 more)")).toBeVisible();
  await expect(page.getByText("Sign in is required before launching this project.")).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "What are you building?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ready to launch?" })).toHaveCount(0);
});
