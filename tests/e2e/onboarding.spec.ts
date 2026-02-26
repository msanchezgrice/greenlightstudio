import { test, expect } from "@playwright/test";

test("onboarding progresses from import to confirm", async ({ page }) => {
  await page.goto("/onboarding");

  await expect(page.getByRole("heading", { name: "What are you building?" })).toBeVisible();
  await page.getByPlaceholder("Parenting app for dads who want to disconnect from screens and be more present with their kids...").fill(
    "A platform that helps parents plan screen-free family activities with clear time, budget, and location filters.",
  );

  await page.getByRole("button", { name: "Skip scan, go to settings →" }).click();
  await expect(page.getByRole("heading", { name: "How should we operate?" })).toBeVisible();

  await page.getByRole("button", { name: "Review & Launch →" }).click();
  await expect(page.getByRole("heading", { name: "Ready to launch?" })).toBeVisible();
  await expect(page.getByText("Sign in is required before launching this project.")).toBeVisible();
});
