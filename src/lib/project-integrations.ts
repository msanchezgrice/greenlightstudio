import { createDecipheriv, createCipheriv, randomBytes, createHash } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";

type IntegrationProvider = "resend" | "meta" | "github" | "vercel" | "analytics" | "payments";

type IntegrationResolution = {
  source: "project" | "global" | "none";
  config: Record<string, unknown>;
};

type ProjectEmailIdentity = {
  id: string;
  project_id: string;
  provider: string;
  reply_address: string;
  status: "active" | "disabled";
};

function normalizeEncryptionKey() {
  const raw = process.env.PROJECT_INTEGRATION_ENCRYPTION_KEY?.trim();
  if (!raw) return null;

  const maybeBase64 = Buffer.from(raw, "base64");
  if (maybeBase64.length === 32) return maybeBase64;

  const utf8 = Buffer.from(raw, "utf8");
  if (utf8.length === 32) return utf8;

  return createHash("sha256").update(raw).digest();
}

function encryptConfig(config: Record<string, unknown>) {
  const key = normalizeEncryptionKey();
  if (!key) {
    throw new Error("PROJECT_INTEGRATION_ENCRYPTION_KEY is required to store project integration config");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(config), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

function decryptConfig(value: string) {
  const key = normalizeEncryptionKey();
  if (!key) return null;

  const [ivRaw, tagRaw, payloadRaw] = value.split(".");
  if (!ivRaw || !tagRaw || !payloadRaw) return null;

  const iv = Buffer.from(ivRaw, "base64");
  const tag = Buffer.from(tagRaw, "base64");
  const payload = Buffer.from(payloadRaw, "base64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(decrypted) as Record<string, unknown>;
  return parsed;
}

function globalProviderConfig(provider: IntegrationProvider): Record<string, unknown> {
  if (provider === "resend") {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();
    return apiKey && fromEmail
      ? {
          api_key: apiKey,
          from_email: fromEmail,
        }
      : {};
  }

  if (provider === "meta") {
    const token = process.env.META_ACCESS_TOKEN?.trim();
    const adAccountId = process.env.META_AD_ACCOUNT_ID?.trim();
    return token && adAccountId
      ? {
          access_token: token,
          ad_account_id: adAccountId,
        }
      : {};
  }

  if (provider === "github") {
    const token = process.env.GITHUB_TOKEN?.trim();
    return token ? { token } : {};
  }

  if (provider === "vercel") {
    const hook = process.env.VERCEL_DEPLOY_HOOK_URL?.trim();
    return hook ? { deploy_hook_url: hook } : {};
  }

  return {};
}

export function maskIntegrationConfig(config: Record<string, unknown>) {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value === null || typeof value === "undefined") continue;
    if (typeof value !== "string") {
      masked[key] = value;
      continue;
    }
    if (value.length <= 6) {
      masked[key] = "***";
      continue;
    }
    masked[key] = `${value.slice(0, 3)}***${value.slice(-2)}`;
  }
  return masked;
}

export async function upsertProjectIntegration(input: {
  projectId: string;
  provider: IntegrationProvider;
  config: Record<string, unknown>;
  enabled?: boolean;
}) {
  const db = createServiceSupabase();
  const encrypted = encryptConfig(input.config);
  const masked = maskIntegrationConfig(input.config);

  const { error } = await withRetry(() =>
    db
      .from("project_integrations")
      .upsert(
        {
          project_id: input.projectId,
          provider: input.provider,
          enabled: input.enabled ?? true,
          config_encrypted: encrypted,
          config_masked: masked,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "project_id,provider" },
      ),
  );

  if (error) throw new Error(error.message);
}

export async function resolveIntegration(projectId: string, provider: IntegrationProvider): Promise<IntegrationResolution> {
  const db = createServiceSupabase();

  const { data: row } = await withRetry(() =>
    db
      .from("project_integrations")
      .select("enabled,config_encrypted")
      .eq("project_id", projectId)
      .eq("provider", provider)
      .maybeSingle(),
  );

  if (row?.enabled && typeof row.config_encrypted === "string") {
    try {
      const decrypted = decryptConfig(row.config_encrypted);
      if (decrypted && Object.keys(decrypted).length > 0) {
        return { source: "project", config: decrypted };
      }
    } catch {
      // fall back to global
    }
  }

  const global = globalProviderConfig(provider);
  if (Object.keys(global).length > 0) return { source: "global", config: global };
  return { source: "none", config: {} };
}

function inboundDomain() {
  return process.env.PROJECT_INBOUND_DOMAIN?.trim() || "inbound.greenlight.local";
}

function buildReplyAddress(projectId: string) {
  const local = projectId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20).toLowerCase() || randomBytes(6).toString("hex");
  return `${local}@${inboundDomain()}`;
}

export async function ensureProjectEmailIdentity(projectId: string) {
  const db = createServiceSupabase();

  const { data: existing } = await withRetry(() =>
    db
      .from("project_email_identities")
      .select("id,project_id,provider,reply_address,status")
      .eq("project_id", projectId)
      .maybeSingle(),
  );

  if (existing) return existing as ProjectEmailIdentity;

  const replyAddress = buildReplyAddress(projectId);
  const { data, error } = await withRetry(() =>
    db
      .from("project_email_identities")
      .insert({
        project_id: projectId,
        provider: "resend",
        reply_address: replyAddress,
        status: "active",
      })
      .select("id,project_id,provider,reply_address,status")
      .single(),
  );

  if (error) throw new Error(error.message);
  return data as ProjectEmailIdentity;
}

export async function getProjectEmailIdentity(projectId: string) {
  const db = createServiceSupabase();
  const { data } = await withRetry(() =>
    db
      .from("project_email_identities")
      .select("id,project_id,provider,reply_address,status")
      .eq("project_id", projectId)
      .eq("status", "active")
      .maybeSingle(),
  );
  return (data as ProjectEmailIdentity | null) ?? null;
}

export async function getProjectByReplyAddress(replyAddress: string) {
  const db = createServiceSupabase();
  const normalized = replyAddress.trim().toLowerCase();

  const { data, error } = await withRetry(() =>
    db
      .from("project_email_identities")
      .select("id,project_id,provider,reply_address,status")
      .eq("reply_address", normalized)
      .eq("status", "active")
      .maybeSingle(),
  );

  if (error) throw new Error(error.message);
  return (data as ProjectEmailIdentity | null) ?? null;
}
