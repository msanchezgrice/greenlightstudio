import { auth } from "@clerk/nextjs/server";
import { createServiceSupabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, domains, scan_options } = body as {
    name?: string;
    domains: Array<{
      domain: string;
      enabled: boolean;
      target_demo?: string;
      value_prop?: string;
      how_it_works?: string;
      notes?: string;
    }>;
    scan_options?: Record<string, boolean>;
  };

  if (!Array.isArray(domains) || domains.length === 0) {
    return NextResponse.json({ error: "At least one domain is required" }, { status: 400 });
  }

  const db = createServiceSupabase();

  const enabledDomains = domains.filter((d) => d.enabled !== false);

  // Create batch
  const { data: batch, error: batchError } = await db
    .from("batches")
    .insert({
      owner_clerk_id: userId,
      name: name || `Bulk Import \u2014 ${enabledDomains.length} Projects`,
      domain_count: enabledDomains.length,
      scan_options: scan_options || {},
    })
    .select()
    .single();

  if (batchError) return NextResponse.json({ error: batchError.message }, { status: 500 });

  // Create projects for each enabled domain
  const projectInserts = enabledDomains.map((d) => ({
    owner_clerk_id: userId,
    name: d.domain,
    domain: d.domain,
    idea_description: [
      d.value_prop,
      d.target_demo ? `Target: ${d.target_demo}` : "",
      d.how_it_works ? `How: ${d.how_it_works}` : "",
      d.notes,
    ]
      .filter(Boolean)
      .join(". ") || `Startup analysis for ${d.domain}`,
    phase: 0,
    batch_id: batch.id,
    runtime_mode: "shared",
  }));

  if (projectInserts.length) {
    const { error: projError } = await db.from("projects").insert(projectInserts);
    if (projError) return NextResponse.json({ error: projError.message }, { status: 500 });
  }

  return NextResponse.json({ batch });
}
