import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { scanDomain } from "@/lib/scanner";
import { get_scan_cache, set_scan_cache } from "@/lib/supabase-mcp";
import { withRetry } from "@/lib/retry";
import { scanResultSchema } from "@/types/domain";

const bodySchema = z.object({ domain: z.string().min(3) });

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = bodySchema.parse(await req.json());
  const domain = body.domain.trim().toLowerCase();

  const cached = await withRetry(() => get_scan_cache(domain));
  if (cached) {
    return NextResponse.json({ ...cached, cache_hit: true });
  }

  const result = await scanDomain(domain);
  const parsed = scanResultSchema.parse(result);
  await withRetry(() => set_scan_cache(domain, parsed));
  return NextResponse.json({ ...parsed, cache_hit: false });
}
