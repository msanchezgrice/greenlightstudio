import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase";

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

  const { data: project, error: projectError } = await db
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("owner_clerk_id", userId)
    .maybeSingle();

  if (projectError || !project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { data: asset, error } = await db
    .from("project_assets")
    .select("storage_bucket,storage_path,mime_type")
    .eq("id", assetId)
    .eq("project_id", projectId)
    .eq("status", "uploaded")
    .single();

  if (error || !asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  const { data: file, error: dlError } = await db.storage
    .from(asset.storage_bucket)
    .download(asset.storage_path);

  if (dlError || !file) {
    return NextResponse.json({ error: "Failed to retrieve asset" }, { status: 502 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = asset.mime_type ?? "application/octet-stream";
  const filename = asset.storage_path.split("/").pop() ?? "file";
  const isDownload = mime.includes("officedocument") || mime.includes("zip") || mime.includes("pdf");

  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Cache-Control": "public, max-age=86400, immutable",
  };
  if (isDownload) {
    headers["Content-Disposition"] = `attachment; filename="${filename}"`;
  }

  return new NextResponse(buffer, { headers });
}
