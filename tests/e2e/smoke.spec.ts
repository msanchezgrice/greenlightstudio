import { test, expect } from "@playwright/test";

test("home renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your next idea deserves more than a domain pile." })).toBeVisible();
});
