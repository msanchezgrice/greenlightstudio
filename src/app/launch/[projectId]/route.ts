import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";

export async function GET(_: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  const db = createServiceSupabase();

  const { data, error } = await withRetry(() =>
    db
      .from("project_deployments")
      .select("html_content,status")
      .eq("project_id", projectId)
      .eq("status", "ready")
      .maybeSingle(),
  );

  if (error || !data) {
    return new NextResponse("Launch page not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  return new NextResponse(data.html_content as string, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}
