import { test, expect } from "@playwright/test";

test("home renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Greenlight Studio")).toBeVisible();
});
