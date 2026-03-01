import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";

export async function GET(_: Request, context: { params: Promise<{ projectId: string }> }) {
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

  const { data: assets, error: assetsError } = await withRetry(() =>
    db
      .from("project_assets")
      .select("id,phase,kind,filename,mime_type,size_bytes,status,created_at,storage_bucket,storage_path,metadata")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
  );

  if (assetsError) {
    return NextResponse.json({ error: assetsError.message }, { status: 400 });
  }

  return NextResponse.json({ assets: assets ?? [] });
}
