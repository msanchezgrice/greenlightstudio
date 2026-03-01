import { withRetry } from "@/lib/retry";

function requireRuntimeEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 20000,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function triggerVercelDeployHook(payload: Record<string, unknown>) {
  const deployHook = requireRuntimeEnv("VERCEL_DEPLOY_HOOK_URL");
  const res = await withRetry(() =>
    fetchWithTimeout(deployHook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, 15000),
  );

  if (!res.ok) {
    throw new Error(`Vercel deploy hook failed (HTTP ${res.status})`);
  }

  return { ok: true };
}

export async function sendResendEmail(input: { to: string; subject: string; html: string }) {
  const apiKey = requireRuntimeEnv("RESEND_API_KEY");
  const from = requireRuntimeEnv("RESEND_FROM_EMAIL");

  const res = await withRetry(() =>
    fetchWithTimeout("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
      }),
    }, 15000),
  );

  const json = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
  if (!res.ok) {
    throw new Error(json?.message ?? `Resend request failed (HTTP ${res.status})`);
  }
  if (!json?.id) {
    throw new Error("Resend did not return a message id");
  }

  return { id: json.id };
}

export async function createMetaCampaign(input: {
  name: string;
  dailyBudgetUsd: number;
  objective?: string;
}) {
  const accessToken = requireRuntimeEnv("META_ACCESS_TOKEN");
  const accountId = requireRuntimeEnv("META_AD_ACCOUNT_ID");
  const dailyBudget = Math.max(0, Math.round(input.dailyBudgetUsd * 100));
  const body = new URLSearchParams({
    name: input.name,
    objective: input.objective ?? "OUTCOME_TRAFFIC",
    status: "PAUSED",
    buying_type: "AUCTION",
    special_ad_categories: "[]",
    daily_budget: String(dailyBudget),
    access_token: accessToken,
  });

  const res = await withRetry(() =>
    fetchWithTimeout(`https://graph.facebook.com/v21.0/act_${accountId}/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }, 20000),
  );

  const json = (await res.json().catch(() => null)) as { id?: string; error?: { message?: string } } | null;
  if (!res.ok) {
    throw new Error(json?.error?.message ?? `Meta campaign request failed (HTTP ${res.status})`);
  }
  if (!json?.id) {
    throw new Error("Meta campaign API did not return campaign id");
  }

  return { campaignId: json.id };
}

export async function triggerGitHubRepositoryDispatch(input: {
  repoUrl: string;
  eventType: string;
  clientPayload: Record<string, unknown>;
}) {
  const token = requireRuntimeEnv("GITHUB_TOKEN");
  const parsed = input.repoUrl
    .replace(/\.git$/i, "")
    .match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/?$/i);
  if (!parsed) {
    throw new Error("Repository URL must be a valid GitHub repository URL.");
  }
  const owner = parsed[1];
  const repo = parsed[2];

  const res = await withRetry(() =>
    fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "greenlight-studio/1.0",
      },
      body: JSON.stringify({
        event_type: input.eventType,
        client_payload: input.clientPayload,
      }),
    }, 20000),
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub dispatch failed (HTTP ${res.status})${body ? `: ${body}` : ""}`);
  }

  return { ok: true, owner, repo };
}
