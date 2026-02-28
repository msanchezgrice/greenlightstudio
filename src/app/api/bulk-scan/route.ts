import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { scanDomain } from "@/lib/scanner";
import { get_scan_cache, set_scan_cache } from "@/lib/supabase-mcp";
import { withRetry } from "@/lib/retry";
import { scanResultSchema, type ScanResult } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 120;

const CONCURRENCY_LIMIT = 3;

const bodySchema = z.object({
  domains: z.array(z.string().min(1)).min(1).max(50),
});

const suggestionsSchema = z.object({
  target_demo: z.string(),
  value_prop: z.string(),
  how_it_works: z.string(),
  notes: z.string(),
});

type Suggestions = z.infer<typeof suggestionsSchema>;

type BulkScanResult = {
  domain: string;
  scan: ScanResult | null;
  suggestions: Suggestions | null;
  error?: string;
};

function shouldCacheScanResult(result: ScanResult) {
  if (result.error?.includes("Competitor scan failed")) return false;
  if (result.existing_content === "site" && result.competitors_found.length === 0) return false;
  return true;
}

function shouldUseCachedResult(result: ScanResult) {
  if (result.existing_content === "site" && result.competitors_found.length === 0) return false;
  return true;
}

function normalizeDomain(raw: string) {
  return raw
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
}

async function scanWithCache(domain: string): Promise<ScanResult> {
  const cached = await withRetry(() => get_scan_cache(domain));
  if (cached) {
    const parsedCached = scanResultSchema.parse(cached);
    if (shouldUseCachedResult(parsedCached)) return parsedCached;
  }

  const result = await scanDomain({ domain });
  const parsed = scanResultSchema.parse(result);

  if (shouldCacheScanResult(parsed)) {
    await withRetry(() => set_scan_cache(domain, parsed)).catch(() => {
      // Cache write failure is non-critical; continue.
    });
  }

  return parsed;
}

async function generateSuggestions(domain: string, scan: ScanResult): Promise<Suggestions> {
  const client = new Anthropic();

  const prompt = `Based on this domain scan data, suggest brief values for a startup analysis form.

Domain: ${domain}
Title: ${scan.meta?.title ?? "Unknown"}
Description: ${scan.meta?.desc ?? "Unknown"}
DNS: ${scan.dns ?? "Unknown"}
Content: ${scan.existing_content}
Tech Stack: ${(scan.tech_stack ?? []).join(", ") || "Unknown"}
Competitors: ${(scan.competitors_found ?? []).map((c) => c.name).join(", ") || "None found"}

Return a JSON object with exactly these fields:
- target_demo: 1-2 sentence description of target audience
- value_prop: 1-2 sentence value proposition
- how_it_works: 1-2 sentence description of how the product works
- notes: Brief notes about findings (tech stack, competitors, domain status)

JSON only, no markdown:`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  const parsed = JSON.parse(text) as unknown;
  return suggestionsSchema.parse(parsed);
}

async function processDomain(domain: string): Promise<BulkScanResult> {
  let scan: ScanResult | null = null;
  let suggestions: Suggestions | null = null;

  try {
    scan = await scanWithCache(domain);
  } catch (err) {
    return {
      domain,
      scan: null,
      suggestions: null,
      error: err instanceof Error ? err.message : "Scan failed",
    };
  }

  try {
    suggestions = await generateSuggestions(domain, scan);
  } catch (err) {
    // LLM suggestion failure is non-critical; return scan without suggestions.
    return {
      domain,
      scan,
      suggestions: null,
      error: err instanceof Error ? `Suggestion generation failed: ${err.message}` : "Suggestion generation failed",
    };
  }

  return { domain, scan, suggestions };
}

async function processInBatches(domains: string[]): Promise<BulkScanResult[]> {
  const results: BulkScanResult[] = [];

  for (let i = 0; i < domains.length; i += CONCURRENCY_LIMIT) {
    const batch = domains.slice(i, i + CONCURRENCY_LIMIT);
    const batchResults = await Promise.all(batch.map((domain) => processDomain(domain)));
    results.push(...batchResults);
  }

  return results;
}

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    const domains = [...new Set(body.domains.map(normalizeDomain).filter(Boolean))];

    if (domains.length === 0) {
      return NextResponse.json({ error: "No valid domains provided." }, { status: 400 });
    }

    const results = await processInBatches(domains);

    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Bulk scan failed." },
      { status: 500 },
    );
  }
}
