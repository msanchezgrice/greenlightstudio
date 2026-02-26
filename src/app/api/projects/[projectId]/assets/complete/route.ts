import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";

const bodySchema = z.object({
  assetId: z.string().uuid(),
});

export async function POST(req: Request, context: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await context.params;
  const body = bodySchema.parse(await req.json());
  const db = createServiceSupabase();

  const [{ data: project, error: projectError }, { data: asset, error: assetError }] = await Promise.all([
    withRetry(() => db.from("projects").select("id,owner_clerk_id").eq("id", projectId).single()),
    withRetry(() =>
      db
        .from("project_assets")
        .select("id,storage_bucket,storage_path,status")
        .eq("id", body.assetId)
        .eq("project_id", projectId)
        .single(),
    ),
  ]);

  if (projectError || !project || project.owner_clerk_id !== userId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (assetError || !asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  const downloaded = await withRetry(() =>
    db.storage.from(asset.storage_bucket as string).download(asset.storage_path as string),
  );
  if (downloaded.error) {
    return NextResponse.json({ error: `Upload verification failed: ${downloaded.error.message}` }, { status: 400 });
  }

  const { error: updateError } = await withRetry(() =>
    db
      .from("project_assets")
      .update({
        status: "uploaded",
        metadata: { uploaded_at: new Date().toISOString() },
      })
      .eq("id", body.assetId),
  );

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, assetId: body.assetId });
}
