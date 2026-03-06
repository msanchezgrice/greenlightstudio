import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

type Summary = {
  status:
    | "success"
    | "mfa_required"
    | "launch_completed"
    | "launch_not_attempted"
    | "launch_not_available"
    | "error";
  baseUrl: string;
  finalUrl: string;
  screenshotPath: string;
  note: string;
  bodySnippet: string;
  error?: string;
};

const baseUrl = (process.env.PLAYWRIGHT_BASE_URL ?? "https://startupmachine.ai").replace(/\/$/, "");
const email = process.env.PLAYWRIGHT_LIVE_EMAIL;
const password = process.env.PLAYWRIGHT_LIVE_PASSWORD;
const mfaCode = process.env.PLAYWRIGHT_LIVE_MFA_CODE;
const shouldLaunch = process.env.PLAYWRIGHT_LIVE_LAUNCH === "true";
const resultsDir = path.resolve("test-results");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

async function main() {
  const safeEmail = requireEnv("PLAYWRIGHT_LIVE_EMAIL", email);
  const safePassword = requireEnv("PLAYWRIGHT_LIVE_PASSWORD", password);
  await fs.mkdir(resultsDir, { recursive: true });

  const screenshotPath = path.join(resultsDir, `${timestamp}-live-signin.png`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  let summary: Summary;

  try {
    await page.goto(`${baseUrl}/onboarding?new=1`, { waitUntil: "networkidle", timeout: 120_000 });
    await page.getByRole("button", { name: /Just an idea/i }).click();
    await page
      .getByPlaceholder("AI workflow copilot for boutique agencies that turns client requests into scoped tasks, timelines, and margin-aware estimates.")
      .fill("Playwright validation project for the live onboarding handoff and save flow.");
    await page.getByRole("button", { name: "Generate Instant Brief →" }).click();
    await page.getByRole("button", { name: "Continue to launch review →" }).click();
    await page.getByRole("link", { name: "I already have an account" }).click();
    await page.waitForURL(/\/sign-in/, { timeout: 30_000 });

    await page.getByPlaceholder("Enter your email address").fill(safeEmail);
    await page.getByPlaceholder("Enter your password").fill(safePassword);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.waitForTimeout(5_000);

    if (/factor-two/.test(page.url())) {
      if (!mfaCode) {
        summary = {
          status: "mfa_required",
          baseUrl,
          finalUrl: page.url(),
          screenshotPath,
          note: "Sign-in requires a second-factor email code on a new device. Re-run with PLAYWRIGHT_LIVE_MFA_CODE to continue.",
          bodySnippet: (await page.locator("body").innerText()).slice(0, 1_600),
        };
      } else {
        await page.getByLabel("Enter verification code").fill(mfaCode);
        await page.getByRole("button", { name: "Continue", exact: true }).click();
        await page.waitForTimeout(8_000);

        if (shouldLaunch) {
          const launchButton = page.getByRole("button", { name: "Launch Full Phase 0 →" });

          if (await launchButton.isVisible().catch(() => false)) {
            if (await launchButton.isEnabled().catch(() => false)) {
              await launchButton.click();
              await page.waitForTimeout(15_000);
              summary = {
                status: "launch_completed",
                baseUrl,
                finalUrl: page.url(),
                screenshotPath,
                note: "Sign-in completed and the runner attempted the launch step.",
                bodySnippet: (await page.locator("body").innerText()).slice(0, 1_600),
              };
            } else {
              summary = {
                status: "launch_not_available",
                baseUrl,
                finalUrl: page.url(),
                screenshotPath,
                note: "Sign-in completed but the launch button was still disabled.",
                bodySnippet: (await page.locator("body").innerText()).slice(0, 1_600),
              };
            }
          } else {
            summary = {
              status: "launch_not_available",
              baseUrl,
              finalUrl: page.url(),
              screenshotPath,
              note: "Sign-in completed but the onboarding confirm state was not visible afterward.",
              bodySnippet: (await page.locator("body").innerText()).slice(0, 1_600),
            };
          }
        } else {
          summary = {
            status: "launch_not_attempted",
            baseUrl,
            finalUrl: page.url(),
            screenshotPath,
            note: "Sign-in completed. Launch was skipped because PLAYWRIGHT_LIVE_LAUNCH was not set to true.",
            bodySnippet: (await page.locator("body").innerText()).slice(0, 1_600),
          };
        }
      }
    } else {
      summary = {
        status: shouldLaunch ? "launch_not_available" : "success",
        baseUrl,
        finalUrl: page.url(),
        screenshotPath,
        note: "Sign-in did not require second factor and reached the authenticated app flow.",
        bodySnippet: (await page.locator("body").innerText()).slice(0, 1_600),
      };
    }
  } catch (error) {
    summary = {
      status: "error",
      baseUrl,
      finalUrl: page.url(),
      screenshotPath,
      note: "The live sign-in runner threw before completion.",
      bodySnippet: await page.locator("body").innerText().then((text) => text.slice(0, 1_600)).catch(() => ""),
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    };
  }

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  console.log(JSON.stringify(summary, null, 2));

  await context.close();
  await browser.close();

  if (summary.status === "error" || summary.status === "mfa_required") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
