import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; assetId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId, assetId } = await params;
  const db = createServiceSupabase();

  const { data: project, error: projectError } = await withRetry(() =>
    db
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("owner_clerk_id", userId)
      .maybeSingle(),
  );

  if (projectError || !project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { data: asset, error } = await withRetry(() =>
    db
      .from("project_assets")
      .select("storage_bucket,storage_path,mime_type,filename")
      .eq("id", assetId)
      .eq("project_id", projectId)
      .eq("status", "uploaded")
      .single(),
  );

  if (error || !asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  const { data: file, error: downloadError } = await withRetry(() =>
    db.storage.from(asset.storage_bucket).download(asset.storage_path),
  );

  if (downloadError || !file) {
    return NextResponse.json({ error: "Failed to retrieve asset" }, { status: 502 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = asset.mime_type ?? "application/octet-stream";
  const filename = asset.filename ?? asset.storage_path.split("/").pop() ?? "download";

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
