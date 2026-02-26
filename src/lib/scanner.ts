import { resolveAny } from "node:dns/promises";
import { competitorSchema, repoSummarySchema, scanResultSchema, type RepoSummary, type ScanResult } from "@/types/domain";

type ScanInput = {
  domain?: string | null;
  repoUrl?: string | null;
  ideaDescription?: string | null;
};

const parkedSignals = [
  "domain for sale",
  "is parked",
  "godaddy",
  "sedo",
  "namecheap parking",
  "buy this domain",
  "afternic",
];

function stripProtocol(value: string) {
  return value.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim().toLowerCase();
}

function toHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeDomain(domain: string | null | undefined) {
  if (!domain) return null;
  const normalized = stripProtocol(domain);
  return normalized || null;
}

function classifyContent(html: string): "site" | "parked" | "none" {
  const lower = html.toLowerCase();
  if (!lower.trim()) return "none";
  if (parkedSignals.some((signal) => lower.includes(signal))) return "parked";
  return "site";
}

function parseMeta(html: string) {
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null;
  const desc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1]?.trim() ?? null;
  const og = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["']/i)?.[1]?.trim() ?? null;
  return { title, desc, og_image: og };
}

function parseText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectTech(html: string, headers: Headers): string[] {
  const lower = html.toLowerCase();
  const server = headers.get("server")?.toLowerCase() ?? "";
  const poweredBy = headers.get("x-powered-by")?.toLowerCase() ?? "";
  const tech = new Set<string>();

  if (lower.includes("__next") || lower.includes("_next/")) tech.add("Next.js");
  if (lower.includes("react")) tech.add("React");
  if (lower.includes("wp-content")) tech.add("WordPress");
  if (lower.includes("shopify")) tech.add("Shopify");
  if (lower.includes("tailwind")) tech.add("Tailwind CSS");
  if (lower.includes("supabase")) tech.add("Supabase");
  if (lower.includes("clerk")) tech.add("Clerk");
  if (server.includes("vercel")) tech.add("Vercel");
  if (server.includes("cloudflare")) tech.add("Cloudflare");
  if (poweredBy.includes("next")) tech.add("Next.js");

  return [...tech];
}

async function fetchText(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

function parseGitHubRepo(repoUrl: string) {
  const clean = repoUrl.replace(/\.git$/i, "");
  const match = clean.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/?#]+)/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function parseGitLabRepo(repoUrl: string) {
  const clean = repoUrl.replace(/\.git$/i, "");
  const match = clean.match(/^https?:\/\/gitlab\.com\/(.+)$/i);
  if (!match) return null;
  const path = match[1].replace(/\/+$/, "");
  if (!path.includes("/")) return null;
  return { path };
}

function inferFrameworkFromFiles(files: string[], packageJsonText: string | null) {
  const names = files.map((name) => name.toLowerCase());

  if (names.includes("next.config.js") || names.includes("next.config.mjs") || names.includes("next.config.ts")) return "Next.js";
  if (names.includes("nuxt.config.js") || names.includes("nuxt.config.ts")) return "Nuxt";
  if (names.includes("svelte.config.js")) return "SvelteKit";
  if (names.includes("astro.config.mjs")) return "Astro";
  if (names.includes("vite.config.ts") || names.includes("vite.config.js")) return "Vite";
  if (names.includes("angular.json")) return "Angular";
  if (names.includes("gatsby-config.js")) return "Gatsby";
  if (names.includes("composer.json")) return "PHP";
  if (names.includes("go.mod")) return "Go";
  if (names.includes("cargo.toml")) return "Rust";

  if (!packageJsonText) return null;

  try {
    const parsed = JSON.parse(packageJsonText) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...parsed.dependencies, ...parsed.devDependencies };
    if (deps.next) return "Next.js";
    if (deps.react) return "React";
    if (deps.nuxt) return "Nuxt";
    if (deps["@sveltejs/kit"]) return "SvelteKit";
    if (deps.astro) return "Astro";
    if (deps.vue) return "Vue";
    if (deps.angular) return "Angular";
  } catch {
    return null;
  }

  return null;
}

function decodeDuckDuckGoUrl(raw: string) {
  try {
    const parsed = new URL(raw, "https://duckduckgo.com");
    const wrapped = parsed.searchParams.get("uddg");
    if (wrapped) return decodeURIComponent(wrapped);
    return parsed.toString();
  } catch {
    return raw;
  }
}

async function findCompetitors(query: string, excludedHost: string | null) {
  if (!query.trim()) return [];

  const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(`${query} competitors alternatives`)}`;
  const { text } = await fetchText(searchUrl, 12000);

  const matches = [...text.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)];
  const competitors: Array<{ name: string; url?: string; snippet?: string }> = [];
  const seenHosts = new Set<string>();

  for (const match of matches) {
    const href = decodeDuckDuckGoUrl(match[1]);
    const host = toHost(href);
    if (!host) continue;
    if (excludedHost && host.includes(excludedHost)) continue;
    if (host.includes("duckduckgo.com")) continue;
    if (host.includes("github.com") || host.includes("gitlab.com")) continue;
    if (seenHosts.has(host)) continue;

    const name = match[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!name) continue;

    seenHosts.add(host);
    competitors.push({ name, url: href });
    if (competitors.length >= 5) break;
  }

  return competitors.map((entry) => competitorSchema.parse(entry));
}

async function scanGitHub(repoUrl: string): Promise<RepoSummary> {
  const parsed = parseGitHubRepo(repoUrl);
  if (!parsed) throw new Error("Invalid GitHub repository URL");

  const headers = { Accept: "application/vnd.github+json", "User-Agent": "greenlight-studio/1.0" };
  const base = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;

  const repoRes = await fetch(base, { headers });
  if (!repoRes.ok) {
    throw new Error(`GitHub API returned ${repoRes.status} for repository lookup`);
  }
  const repoJson = (await repoRes.json()) as { full_name: string; language: string | null; size: number; pushed_at: string | null };

  const languagesPromise = fetch(`${base}/languages`, { headers });
  const rootPromise = fetch(`${base}/contents`, { headers });
  const packagePromise = fetch(`${base}/contents/package.json`, { headers });

  const [languagesRes, rootRes, packageRes] = await Promise.all([languagesPromise, rootPromise, packagePromise]);

  let language = repoJson.language;
  if (languagesRes.ok) {
    const languages = (await languagesRes.json()) as Record<string, number>;
    const top = Object.entries(languages).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (top) language = top;
  }

  let keyFiles: string[] = [];
  if (rootRes.ok) {
    const root = (await rootRes.json()) as Array<{ name: string; type: string }>;
    keyFiles = root.filter((entry) => entry.type === "file").map((entry) => entry.name).slice(0, 8);
  }

  let packageJsonText: string | null = null;
  if (packageRes.ok) {
    const packageJson = (await packageRes.json()) as { content?: string; encoding?: string };
    if (packageJson.encoding === "base64" && packageJson.content) {
      packageJsonText = Buffer.from(packageJson.content, "base64").toString("utf8");
    }
  }

  const framework = inferFrameworkFromFiles(keyFiles, packageJsonText);

  return repoSummarySchema.parse({
    provider: "github",
    repo: repoJson.full_name,
    framework,
    language,
    loc: repoJson.size > 0 ? repoJson.size * 4 : null,
    last_commit: repoJson.pushed_at,
    key_files: keyFiles,
  });
}

async function scanGitLab(repoUrl: string): Promise<RepoSummary> {
  const parsed = parseGitLabRepo(repoUrl);
  if (!parsed) throw new Error("Invalid GitLab repository URL");

  const encodedPath = encodeURIComponent(parsed.path);
  const base = `https://gitlab.com/api/v4/projects/${encodedPath}`;

  const repoRes = await fetch(base);
  if (!repoRes.ok) {
    throw new Error(`GitLab API returned ${repoRes.status} for repository lookup`);
  }
  const repoJson = (await repoRes.json()) as { path_with_namespace: string; last_activity_at: string | null };

  const [languagesRes, treeRes] = await Promise.all([fetch(`${base}/languages`), fetch(`${base}/repository/tree?per_page=20`)]);

  let language: string | null = null;
  if (languagesRes.ok) {
    const languages = (await languagesRes.json()) as Record<string, number>;
    language = Object.entries(languages).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }

  let keyFiles: string[] = [];
  if (treeRes.ok) {
    const tree = (await treeRes.json()) as Array<{ name: string; type: string }>;
    keyFiles = tree.filter((entry) => entry.type === "blob").map((entry) => entry.name).slice(0, 8);
  }

  const framework = inferFrameworkFromFiles(keyFiles, null);

  return repoSummarySchema.parse({
    provider: "gitlab",
    repo: repoJson.path_with_namespace,
    framework,
    language,
    loc: null,
    last_commit: repoJson.last_activity_at,
    key_files: keyFiles,
  });
}

async function scanRepo(repoUrl: string): Promise<RepoSummary> {
  if (/github\.com/i.test(repoUrl)) return scanGitHub(repoUrl);
  if (/gitlab\.com/i.test(repoUrl)) return scanGitLab(repoUrl);
  throw new Error("Unsupported repository host. Use GitHub or GitLab.");
}

export async function scanDomain(input: ScanInput): Promise<ScanResult> {
  const domain = normalizeDomain(input.domain);
  const repoUrl = input.repoUrl?.trim() || null;
  const ideaDescription = input.ideaDescription?.trim() || "";

  if (!domain && !repoUrl) {
    return scanResultSchema.parse({
      domain: null,
      dns: null,
      http_status: null,
      tech_stack: null,
      meta: null,
      existing_content: "none",
      repo_summary: null,
      competitors_found: [],
      error: "Add a domain or repository URL to run discovery.",
    });
  }

  let dns: "live" | "parked" | "none" | null = null;
  let httpStatus: number | null = null;
  let techStack: string[] | null = null;
  let meta: { title: string | null; desc: string | null; og_image: string | null } | null = null;
  let existingContent: "site" | "parked" | "none" = "none";
  let repoSummary: RepoSummary | null = null;
  const errors: string[] = [];

  if (domain) {
    let hasDnsRecord = false;
    try {
      const records = await resolveAny(domain);
      hasDnsRecord = records.length > 0;
    } catch {
      hasDnsRecord = false;
    }

    try {
      const { response, text } = await fetchText(`https://${domain}`, 12000);
      httpStatus = response.status;
      existingContent = classifyContent(text);
      meta = parseMeta(text);
      techStack = detectTech(text, response.headers);

      if (existingContent === "parked") dns = "parked";
      else if (hasDnsRecord || (httpStatus >= 200 && httpStatus < 500)) dns = "live";
      else dns = "none";
    } catch (error) {
      dns = hasDnsRecord ? "live" : "none";
      errors.push(error instanceof Error ? `Domain scan failed: ${error.message}` : "Domain scan failed");
    }
  }

  if (repoUrl) {
    try {
      repoSummary = await scanRepo(repoUrl);
    } catch (error) {
      repoSummary = repoSummarySchema.parse({
        provider: /gitlab\.com/i.test(repoUrl) ? "gitlab" : /github\.com/i.test(repoUrl) ? "github" : null,
        repo: null,
        framework: null,
        language: null,
        loc: null,
        last_commit: null,
        key_files: [],
        error: error instanceof Error ? error.message : "Repository scan failed",
      });
      errors.push(repoSummary.error ?? "Repository scan failed");
    }
  }

  const competitorQuery = meta?.title || parseText(ideaDescription).slice(0, 80) || domain || "";
  let competitorsFound: Array<{ name: string; url?: string; snippet?: string }> = [];
  try {
    competitorsFound = await findCompetitors(competitorQuery, domain);
  } catch (error) {
    errors.push(error instanceof Error ? `Competitor scan failed: ${error.message}` : "Competitor scan failed");
  }

  return scanResultSchema.parse({
    domain,
    dns,
    http_status: httpStatus,
    tech_stack: techStack,
    meta,
    existing_content: existingContent,
    repo_summary: repoSummary,
    competitors_found: competitorsFound,
    error: errors.length ? errors.join(" | ") : undefined,
  });
}
