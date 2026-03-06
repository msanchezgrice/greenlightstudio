import fs from "node:fs/promises";
import path from "node:path";
import { chromium, firefox, webkit } from "@playwright/test";
import type { BrowserType, Page } from "@playwright/test";

type BrowserName = "chromium" | "firefox" | "webkit";

type Mailbox = {
  address: string;
  password: string;
  token: string;
};

type RunnerStatus =
  | "success"
  | "blocked_by_turnstile"
  | "verification_email_not_received"
  | "verification_step_not_reached"
  | "unexpected_state"
  | "error";

type RunnerSummary = {
  browser: BrowserName;
  status: RunnerStatus;
  baseUrl: string;
  homePreviewVerified: boolean;
  finalUrl: string;
  mailbox: string;
  frameUrls: string[];
  screenshotPath: string;
  note: string;
  bodySnippet: string;
  error?: string;
};

type MailMessage = {
  id: string;
  intro?: string;
  subject?: string;
  text?: string;
  html?: string[];
};

const browserTypes: Record<BrowserName, BrowserType> = { chromium, firefox, webkit };
const baseUrl = (process.env.PLAYWRIGHT_BASE_URL ?? "https://startupmachine.ai").replace(/\/$/, "");
const requestedBrowsers = (process.env.PLAYWRIGHT_LIVE_BROWSERS ?? "chromium")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean) as BrowserName[];
const browserNames = requestedBrowsers.filter((value, index, all): value is BrowserName => value in browserTypes && all.indexOf(value) === index);
const headless = process.env.PLAYWRIGHT_HEADLESS !== "false";
const resultsDir = path.resolve("test-results");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

async function ensureResultsDir() {
  await fs.mkdir(resultsDir, { recursive: true });
}

async function createMailbox(): Promise<Mailbox> {
  const domainsResponse = await fetch("https://api.mail.tm/domains");
  const domainsPayload = (await domainsResponse.json()) as { "hydra:member"?: Array<{ domain: string }> };
  const domain = domainsPayload["hydra:member"]?.[0]?.domain;

  if (!domain) {
    throw new Error("mail.tm did not return an active domain");
  }

  const localPart = `sm${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const address = `${localPart}@${domain}`;
  const password = `${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}Aa!`;

  const accountResponse = await fetch("https://api.mail.tm/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, password }),
  });

  if (!accountResponse.ok) {
    throw new Error(`mail.tm account creation failed with ${accountResponse.status}`);
  }

  const tokenResponse = await fetch("https://api.mail.tm/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, password }),
  });

  if (!tokenResponse.ok) {
    throw new Error(`mail.tm token creation failed with ${tokenResponse.status}`);
  }

  const tokenPayload = (await tokenResponse.json()) as { token?: string };

  if (!tokenPayload.token) {
    throw new Error("mail.tm token payload did not include a token");
  }

  return { address, password, token: tokenPayload.token };
}

async function pollForVerificationMessage(token: string, timeoutMs = 90_000): Promise<MailMessage | null> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const messagesResponse = await fetch("https://api.mail.tm/messages", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!messagesResponse.ok) {
      throw new Error(`mail.tm message list failed with ${messagesResponse.status}`);
    }

    const messagesPayload = (await messagesResponse.json()) as { "hydra:member"?: MailMessage[] };
    const message = messagesPayload["hydra:member"]?.[0];

    if (message?.id) {
      const detailResponse = await fetch(`https://api.mail.tm/messages/${message.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!detailResponse.ok) {
        throw new Error(`mail.tm message detail failed with ${detailResponse.status}`);
      }

      return (await detailResponse.json()) as MailMessage;
    }

    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  return null;
}

function parseVerificationMessage(message: MailMessage): { code?: string; link?: string; raw: string } {
  const raw = [message.subject ?? "", message.intro ?? "", message.text ?? "", ...(message.html ?? [])]
    .filter(Boolean)
    .join("\n");

  const codeMatch = raw.match(/\b(\d{6})\b/);
  const links = raw.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  const link = links.find((value) => /clerk|startupmachine|verify|ticket/i.test(value));

  return { code: codeMatch?.[1], link, raw };
}

async function verifyHomePreviewPath(page: Page): Promise<boolean> {
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.getByRole("link", { name: /Preview My Brief/i }).first().click();
  await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
  return page.getByRole("heading", { name: "Start with what you already have" }).isVisible();
}

async function fillSignUp(page: Page, mailbox: Mailbox) {
  await page.goto(`${baseUrl}/sign-up`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.getByPlaceholder("First name").fill("Playwright");
  await page.getByPlaceholder("Last name").fill("Prod");
  await page.getByPlaceholder("Enter your email address").fill(mailbox.address);
  await page.getByPlaceholder("Enter your password").fill(mailbox.password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForTimeout(8_000);
}

async function completeVerification(page: Page, mailbox: Mailbox): Promise<RunnerSummary["status"]> {
  const bodyText = await page.locator("body").innerText();

  if (!/verification code|verify your email|email code|check your email/i.test(bodyText)) {
    return "verification_step_not_reached";
  }

  const message = await pollForVerificationMessage(mailbox.token);

  if (!message) {
    return "verification_email_not_received";
  }

  const parsed = parseVerificationMessage(message);

  if (parsed.link) {
    await page.goto(parsed.link, { waitUntil: "networkidle", timeout: 120_000 });
  } else if (parsed.code) {
    const inputs = page.locator("input");
    const inputCount = await inputs.count();

    if (inputCount >= 6) {
      for (const [index, char] of parsed.code.split("").entries()) {
        await inputs.nth(index).fill(char);
      }
    } else if (inputCount > 0) {
      await inputs.first().fill(parsed.code);
      await page.keyboard.press("Enter");
    } else {
      return "unexpected_state";
    }
  } else {
    return "unexpected_state";
  }

  await page.waitForTimeout(8_000);
  return /\/onboarding|\/board|\/chat|\/tasks/.test(page.url()) ? "success" : "unexpected_state";
}

async function runBrowser(browser: BrowserName): Promise<RunnerSummary> {
  const mailbox = await createMailbox();
  const browserType = browserTypes[browser];
  const browserInstance = await browserType.launch({ headless });
  const context = await browserInstance.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const screenshotPath = path.join(resultsDir, `${timestamp}-live-signup-${browser}.png`);
  let homePreviewVerified = false;

  try {
    homePreviewVerified = await verifyHomePreviewPath(page);
    await fillSignUp(page, mailbox);

    const frameUrls = page.frames().map((frame) => frame.url()).filter(Boolean);
    const challengeFrame = frameUrls.find((url) => url.includes("challenges.cloudflare.com"));

    let status: RunnerStatus;
    let note: string;

    if (challengeFrame && page.url().endsWith("/sign-up")) {
      status = "blocked_by_turnstile";
      note = "Cloudflare Turnstile challenge appeared after submit and blocked unattended Playwright continuation.";
    } else {
      status = await completeVerification(page, mailbox);
      note =
        status === "success"
          ? "Signup reached an authenticated app route."
          : "Signup moved past submit but did not complete an authenticated redirect.";
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });

    return {
      browser,
      status,
      baseUrl,
      homePreviewVerified,
      finalUrl: page.url(),
      mailbox: mailbox.address,
      frameUrls,
      screenshotPath,
      note,
      bodySnippet: (await page.locator("body").innerText()).slice(0, 1_600),
    };
  } catch (error) {
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);

    return {
      browser,
      status: "error",
      baseUrl,
      homePreviewVerified,
      finalUrl: page.url(),
      mailbox: mailbox.address,
      frameUrls: page.frames().map((frame) => frame.url()).filter(Boolean),
      screenshotPath,
      note: "The runner threw before the signup flow completed.",
      bodySnippet: await page.locator("body").innerText().then((text) => text.slice(0, 1_600)).catch(() => ""),
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    };
  } finally {
    await context.close();
    await browserInstance.close();
  }
}

async function main() {
  if (browserNames.length === 0) {
    throw new Error("No valid browsers requested. Use PLAYWRIGHT_LIVE_BROWSERS=chromium,firefox,webkit.");
  }

  await ensureResultsDir();

  const summaries: RunnerSummary[] = [];

  for (const browser of browserNames) {
    const summary = await runBrowser(browser);
    summaries.push(summary);
  }

  const summaryPath = path.join(resultsDir, `${timestamp}-live-signup-summary.json`);
  await fs.writeFile(summaryPath, `${JSON.stringify(summaries, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({ summaryPath, summaries }, null, 2));

  if (summaries.some((summary) => summary.status !== "success")) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
