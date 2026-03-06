import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

type ApiEvent = {
  url: string;
  status: number;
  body?: string;
};

type ConsoleEvent = {
  type: string;
  text: string;
};

type Summary = {
  status:
    | "launched_and_redirected"
    | "launched_waiting_for_redirect"
    | "launch_failed"
    | "signin_required"
    | "error";
  baseUrl: string;
  finalUrl: string;
  profileDir: string;
  beforeLaunchScreenshot: string;
  finalScreenshot: string;
  launchResponses: ApiEvent[];
  progressResponses: ApiEvent[];
  consoleEvents: ConsoleEvent[];
  note: string;
  bodySnippet: string;
  error?: string;
};

const baseUrl = (process.env.PLAYWRIGHT_BASE_URL ?? "https://startupmachine.ai").replace(/\/$/, "");
const email = process.env.PLAYWRIGHT_LIVE_EMAIL;
const password = process.env.PLAYWRIGHT_LIVE_PASSWORD;
const profileDir = path.resolve(process.env.PLAYWRIGHT_LIVE_PROFILE_DIR ?? "test-results/playwright-live-profile");
const resultsDir = path.resolve("test-results");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const beforeLaunchScreenshot = path.join(resultsDir, `${timestamp}-live-launch-before.png`);
const finalScreenshot = path.join(resultsDir, `${timestamp}-live-launch-final.png`);

function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function maybeReadText(response: { text(): Promise<string> }) {
  try {
    return (await response.text()).slice(0, 800);
  } catch {
    return undefined;
  }
}

async function main() {
  const safeEmail = requireEnv("PLAYWRIGHT_LIVE_EMAIL", email);
  const safePassword = requireEnv("PLAYWRIGHT_LIVE_PASSWORD", password);

  await fs.mkdir(resultsDir, { recursive: true });
  await fs.mkdir(profileDir, { recursive: true });

  const launchResponses: ApiEvent[] = [];
  const progressResponses: ApiEvent[] = [];
  const consoleEvents: ConsoleEvent[] = [];

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1440, height: 980 },
    slowMo: 100,
  });

  const page = context.pages()[0] ?? (await context.newPage());

  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "warning" || type === "error") {
      consoleEvents.push({ type, text: msg.text() });
    }
  });

  page.on("response", async (response) => {
    const url = response.url();
    if (/\/api\/projects\/[^/]+\/launch$/.test(url)) {
      launchResponses.push({ url, status: response.status(), body: await maybeReadText(response) });
    }
    if (/\/api\/projects\/[^/]+\/progress$/.test(url)) {
      progressResponses.push({ url, status: response.status(), body: await maybeReadText(response) });
    }
  });

  let summary: Summary;

  try {
    await page.goto(`${baseUrl}/onboarding?new=1`, { waitUntil: "networkidle", timeout: 120_000 });

    if (!(await page.getByRole("heading", { name: "Ready to launch?" }).isVisible().catch(() => false))) {
      await page.getByRole("button", { name: /Just an idea/i }).click();
      await page
        .getByPlaceholder("AI workflow copilot for boutique agencies that turns client requests into scoped tasks, timelines, and margin-aware estimates.")
        .fill("Playwright validation project for the live onboarding handoff and save flow.");
      await page.getByRole("button", { name: "Generate Instant Brief →" }).click();
      await page.getByRole("button", { name: "Continue to launch review →" }).click();
    }

    let launchButton = page.getByRole("button", { name: "Launch Full Phase 0 →" });
    let signInLink = page.getByRole("link", { name: "I already have an account" });
    const unauthenticatedConfirmState =
      (await signInLink.isVisible().catch(() => false)) ||
      (await page.getByRole("link", { name: /Sign In To Save/i }).isVisible().catch(() => false));

    if (!(await launchButton.isVisible().catch(() => false)) || unauthenticatedConfirmState) {
      if (await signInLink.isVisible().catch(() => false)) {
        await signInLink.click();
      } else if (await page.getByRole("link", { name: /Sign In To Save/i }).isVisible().catch(() => false)) {
        await page.getByRole("link", { name: /Sign In To Save/i }).click();
      }

      await page.waitForURL((url) => url.pathname.startsWith("/sign-in"), { timeout: 30_000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => undefined);

      if (/\/sign-in/.test(page.url()) || (await page.getByRole("heading", { name: /Sign in/i }).isVisible().catch(() => false))) {
        await page.getByPlaceholder("Enter your email address").fill(safeEmail);
        await page.getByPlaceholder("Enter your password").fill(safePassword);
        await page.getByRole("button", { name: "Continue", exact: true }).click();
        await page
          .waitForFunction(() => {
            const path = window.location.pathname;
            return path === "/onboarding" || path.startsWith("/sign-in/factor-two");
          }, undefined, { timeout: 120_000 })
          .catch(() => undefined);
      }

      if (/\/sign-in\/factor-two/.test(page.url())) {
        console.log("Waiting for manual MFA completion in the visible browser window...");
        await page.waitForFunction(() => !window.location.pathname.includes("/sign-in/factor-two"), undefined, { timeout: 600_000 });
        await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => undefined);
      }

      await page.waitForURL((url) => url.pathname === "/onboarding", { timeout: 120_000 }).catch(() => undefined);
      launchButton = page.getByRole("button", { name: "Launch Full Phase 0 →" });
      signInLink = page.getByRole("link", { name: "I already have an account" });
    }

    if (!(await launchButton.isVisible().catch(() => false))) {
      summary = {
        status: "signin_required",
        baseUrl,
        finalUrl: page.url(),
        profileDir,
        beforeLaunchScreenshot,
        finalScreenshot,
        launchResponses,
        progressResponses,
        consoleEvents,
        note: "The runner did not reach the authenticated launch review state.",
        bodySnippet: (await page.locator("body").innerText()).slice(0, 1_800),
      };
    } else {
      await page.screenshot({ path: beforeLaunchScreenshot, fullPage: true });
      if (!(await launchButton.isEnabled().catch(() => false))) {
        summary = {
          status: "launch_failed",
          baseUrl,
          finalUrl: page.url(),
          profileDir,
          beforeLaunchScreenshot,
          finalScreenshot,
          launchResponses,
          progressResponses,
          consoleEvents,
          note: "The launch button was visible but disabled.",
          bodySnippet: (await page.locator("body").innerText()).slice(0, 1_800),
        };
      } else {
        await launchButton.click();

        let launchedStateSeen = false;
        let redirectedToWorkspace = false;

        try {
          await page.getByRole("heading", { name: "Project Launched" }).waitFor({ state: "visible", timeout: 30_000 });
          launchedStateSeen = true;
        } catch {
          // The app may redirect quickly before the launched heading becomes visible.
        }

        try {
          await page.waitForURL((url) => /^\/projects\/[^/]+\/phases\/0$/.test(url.pathname), { timeout: 90_000 });
          redirectedToWorkspace = true;
        } catch {
          // Keep the last visible state for reporting.
        }

        await page.screenshot({ path: finalScreenshot, fullPage: true });

        summary = {
          status: redirectedToWorkspace
            ? "launched_and_redirected"
            : launchedStateSeen
              ? "launched_waiting_for_redirect"
              : "launch_failed",
          baseUrl,
          finalUrl: page.url(),
          profileDir,
          beforeLaunchScreenshot,
          finalScreenshot,
          launchResponses,
          progressResponses,
          consoleEvents,
          note: redirectedToWorkspace
            ? "Launch succeeded and redirected into the Phase 0 workspace."
            : launchedStateSeen
              ? "Launch request succeeded and showed the launched state, but workspace redirect did not complete inside the wait window."
              : "Launch did not reach the expected launched or workspace state inside the wait window.",
          bodySnippet: (await page.locator("body").innerText()).slice(0, 2_400),
        };
      }
    }
  } catch (error) {
    await page.screenshot({ path: finalScreenshot, fullPage: true }).catch(() => undefined);
    summary = {
      status: "error",
      baseUrl,
      finalUrl: page.url(),
      profileDir,
      beforeLaunchScreenshot,
      finalScreenshot,
      launchResponses,
      progressResponses,
      consoleEvents,
      note: "The live launch runner threw before completion.",
      bodySnippet: await page.locator("body").innerText().then((text) => text.slice(0, 2_400)).catch(() => ""),
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    };
  }

  console.log(JSON.stringify(summary, null, 2));

  await context.close();

  if (summary.status === "error" || summary.status === "signin_required" || summary.status === "launch_failed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
