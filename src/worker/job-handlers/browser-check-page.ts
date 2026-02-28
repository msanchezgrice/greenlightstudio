import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { writeMemory } from "../memory";

type CheckResult = {
  check: string;
  passed: boolean;
  details: string;
  screenshotUrl?: string;
};

export async function handleBrowserCheckPage(
  db: SupabaseClient,
  job: { id: string; project_id: string; payload: Record<string, unknown> }
) {
  const payload = job.payload ?? {};
  const projectId = (payload.projectId as string) ?? job.project_id;
  const url = payload.url as string;
  const checks = (payload.checks as string[]) ?? [
    "screenshot",
    "mobile_responsive",
    "waitlist_form",
    "meta_tags",
  ];

  if (!url) throw new Error("Missing url in payload");

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "log",
    message: `Launching browser for ${url}`,
  });

  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  const results: CheckResult[] = [];

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(2000);

    if (checks.includes("screenshot")) {
      await emitJobEvent(db, {
        projectId,
        jobId: job.id,
        type: "log",
        message: "Taking desktop screenshot",
      });

      const screenshot = await page.screenshot({ fullPage: true });
      const screenshotPath = `${projectId}/qa/desktop-${Date.now()}.png`;

      const { error: uploadError } = await db.storage
        .from("project-assets")
        .upload(screenshotPath, screenshot, {
          contentType: "image/png",
          upsert: true,
        });

      const signed = uploadError
        ? null
        : await db.storage.from("project-assets").createSignedUrl(screenshotPath, 60 * 60 * 24);
      const screenshotUrl = signed?.error ? undefined : signed?.data.signedUrl;

      results.push({
        check: "screenshot",
        passed: true,
        details: "Desktop screenshot captured (1440x900)",
        screenshotUrl,
      });
    }

    if (checks.includes("mobile_responsive")) {
      await emitJobEvent(db, {
        projectId,
        jobId: job.id,
        type: "log",
        message: "Checking mobile responsiveness",
      });

      const mobileContext = await browser.newContext({
        viewport: { width: 375, height: 812 },
        isMobile: true,
      });
      const mobilePage = await mobileContext.newPage();
      await mobilePage.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      await mobilePage.waitForTimeout(1000);

      const mobileScreenshot = await mobilePage.screenshot({ fullPage: true });
      const mobilePath = `${projectId}/qa/mobile-${Date.now()}.png`;

      const mobileUpload = await db.storage
        .from("project-assets")
        .upload(mobilePath, mobileScreenshot, {
          contentType: "image/png",
          upsert: true,
        });

      const mobileSigned = mobileUpload.error
        ? null
        : await db.storage.from("project-assets").createSignedUrl(mobilePath, 60 * 60 * 24);
      const mobileUrl = mobileSigned?.error ? undefined : mobileSigned?.data.signedUrl;

      const hasViewportMeta = await mobilePage.evaluate(
        () =>
          !!document.querySelector(
            'meta[name="viewport"][content*="width=device-width"]'
          )
      );

      const overflowsX = await mobilePage.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });

      results.push({
        check: "mobile_responsive",
        passed: hasViewportMeta && !overflowsX,
        details: [
          hasViewportMeta ? "viewport meta: OK" : "viewport meta: MISSING",
          overflowsX ? "horizontal overflow: YES (bad)" : "horizontal overflow: none (good)",
        ].join("; "),
        screenshotUrl: mobileUrl,
      });

      await mobileContext.close();
    }

    if (checks.includes("waitlist_form")) {
      await emitJobEvent(db, {
        projectId,
        jobId: job.id,
        type: "log",
        message: "Checking waitlist form",
      });

      const hasForm = await page.evaluate(() => {
        const forms = document.querySelectorAll("form");
        return Array.from(forms).some(
          (f) =>
            f.querySelector('input[type="email"]') !== null ||
            f.textContent?.toLowerCase().includes("waitlist") ||
            f.textContent?.toLowerCase().includes("sign up")
        );
      });

      const hasEmailInput = await page.evaluate(
        () => !!document.querySelector('input[type="email"]')
      );

      results.push({
        check: "waitlist_form",
        passed: hasForm && hasEmailInput,
        details: [
          hasForm ? "form found" : "no form found",
          hasEmailInput ? "email input: present" : "email input: missing",
        ].join("; "),
      });
    }

    if (checks.includes("meta_tags")) {
      await emitJobEvent(db, {
        projectId,
        jobId: job.id,
        type: "log",
        message: "Checking meta tags",
      });

      const meta = await page.evaluate(() => {
        const get = (selector: string) =>
          document.querySelector(selector)?.getAttribute("content") ?? null;
        return {
          title: document.title,
          description: get('meta[name="description"]'),
          ogTitle: get('meta[property="og:title"]'),
          ogDescription: get('meta[property="og:description"]'),
          ogImage: get('meta[property="og:image"]'),
        };
      });

      const hasBasics = !!meta.title && !!meta.description;
      const hasOg = !!meta.ogTitle && !!meta.ogDescription;

      results.push({
        check: "meta_tags",
        passed: hasBasics && hasOg,
        details: [
          meta.title ? `title: "${meta.title}"` : "title: MISSING",
          meta.description ? "description: present" : "description: MISSING",
          hasOg ? "OG tags: present" : "OG tags: incomplete",
          meta.ogImage ? "OG image: present" : "OG image: missing",
        ].join("; "),
      });
    }

    await context.close();
  } finally {
    await browser.close();
  }

  const allPassed = results.every((r) => r.passed);

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "artifact",
    message: allPassed
      ? "All QA checks passed"
      : `QA: ${results.filter((r) => r.passed).length}/${results.length} checks passed`,
    data: { results, allPassed, url },
  });

  await writeMemory(db, projectId, job.id, [
    {
      category: "learning",
      key: `qa_check_${new URL(url).hostname}`,
      value: allPassed
        ? `Landing page at ${url} passes all QA checks`
        : `Landing page at ${url} has issues: ${results.filter((r) => !r.passed).map((r) => r.check).join(", ")}`,
      agentKey: "engineering",
    },
  ]);
}
