import { scanResultSchema, type ScanResult } from "@/types/domain";

const dnsLive = ["200", "301", "302", "401", "403"];

function classifyContent(html: string): "site" | "parked" | "none" {
  const lower = html.toLowerCase();
  if (!html.trim()) return "none";
  if (lower.includes("domain for sale") || lower.includes("parking") || lower.includes("sedo")) return "parked";
  return "site";
}

export async function scanDomain(domain: string): Promise<ScanResult> {
  const url = domain.startsWith("http") ? domain : `https://${domain}`;
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow" });
    const html = await res.text();
    const title = html.match(/<title>(.*?)<\/title>/i)?.[1] ?? null;
    const desc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ?? null;
    const og = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["']/i)?.[1] ?? null;
    const tech = [
      /next/i.test(html) ? "Next.js" : null,
      /react/i.test(html) ? "React" : null,
      /wp-content/i.test(html) ? "WordPress" : null,
      /shopify/i.test(html) ? "Shopify" : null,
    ].filter(Boolean) as string[];

    const existing = classifyContent(html);
    const dns = dnsLive.includes(String(res.status)) ? (existing === "parked" ? "parked" : "live") : "none";
    return scanResultSchema.parse({
      dns,
      http_status: res.status,
      tech_stack: tech,
      meta: { title, desc, og_image: og },
      existing_content: existing,
      competitors_found: [],
    });
  } catch (error) {
    return scanResultSchema.parse({
      dns: null,
      http_status: null,
      tech_stack: null,
      meta: null,
      existing_content: "none",
      competitors_found: [],
      error: error instanceof Error ? error.message : "Unknown scan error",
    });
  }
}
