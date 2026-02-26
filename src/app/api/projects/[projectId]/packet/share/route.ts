import { auth } from "@clerk/nextjs/server";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";

export const runtime = "nodejs";
export const maxDuration = 30;

function newToken() {
  return randomUUID().replaceAll("-", "");
}

export async function POST(req: Request, context: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await context.params;
  const db = createServiceSupabase();

  const { data: project, error: projectError } = await withRetry(() =>
    db.from("projects").select("id,owner_clerk_id").eq("id", projectId).single(),
  );
  if (projectError || !project || project.owner_clerk_id !== userId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { data: existing, error: existingError } = await withRetry(() =>
    db
      .from("packet_share_links")
      .select("token,expires_at")
      .eq("project_id", projectId)
      .is("expires_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 400 });

  const origin = new URL(req.url).origin;
  if (existing?.token) {
    return NextResponse.json({ shareUrl: `${origin}/packet/share/${existing.token}` });
  }

  const token = newToken();
  const { error: insertError } = await withRetry(() =>
    db.from("packet_share_links").insert({
      project_id: projectId,
      token,
      created_by: userId,
      expires_at: null,
    }),
  );
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 400 });

  return NextResponse.json({ shareUrl: `${origin}/packet/share/${token}` });
}

