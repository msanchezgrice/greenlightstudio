import { NextResponse } from "next/server";
import { z } from "zod";
import { scanDomain } from "@/lib/scanner";
import { get_scan_cache, set_scan_cache } from "@/lib/supabase-mcp";
import { withRetry } from "@/lib/retry";
import { scanResultSchema } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 120;

function shouldCacheScanResult(result: z.infer<typeof scanResultSchema>) {
  if (result.error?.includes("Domain scan failed")) return false;
  if (result.error?.includes("Competitor scan failed")) return false;
  if (result.existing_content === "site" && !result.meta?.title && !result.meta?.desc) return false;
  if (result.existing_content === "site" && result.competitors_found.length === 0) return false;
  return true;
}

function shouldUseCachedResult(result: z.infer<typeof scanResultSchema>) {
  if (result.error?.includes("Domain scan failed")) return false;
  if (result.existing_content === "site" && !result.meta?.title && !result.meta?.desc) return false;
  if (result.existing_content === "site" && result.competitors_found.length === 0) return false;
  return true;
}

const bodySchema = z
  .object({
    domain: z.string().min(3).optional().nullable(),
    repo_url: z.string().url().optional().nullable(),
    idea_description: z.string().optional().nullable(),
  })
  .refine((value) => Boolean(value.domain?.trim() || value.repo_url?.trim()), {
    message: "Provide a domain or repository URL.",
    path: ["domain"],
  });

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    const domain = body.domain?.trim().toLowerCase() || null;
    const repoUrl = body.repo_url?.trim() || null;
    const ideaDescription = body.idea_description?.trim() || "";

    if (domain && !repoUrl) {
      const cached = await withRetry(() => get_scan_cache(domain));
      if (cached) {
        const parsedCached = scanResultSchema.parse(cached);
        if (shouldUseCachedResult(parsedCached)) {
          return NextResponse.json({ ...parsedCached, cache_hit: true });
        }
      }
    }

    const result = await scanDomain({ domain, repoUrl, ideaDescription });
    const parsed = scanResultSchema.parse(result);

    if (domain && !repoUrl && shouldCacheScanResult(parsed)) {
      await withRetry(() => set_scan_cache(domain, parsed));
    }

    if (domain && !repoUrl) {
      return NextResponse.json({ ...parsed, cache_hit: false });
    }

    return NextResponse.json({ ...parsed, cache_hit: false, cache_scope: "domain+repo" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid scan request." }, { status: 400 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Discovery scan failed." },
      { status: 500 },
    );
  }
}
