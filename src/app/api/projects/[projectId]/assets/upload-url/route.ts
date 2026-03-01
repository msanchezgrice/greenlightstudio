import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { recordProjectEvent } from "@/lib/project-events";

const bodySchema = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().min(1).max(25 * 1024 * 1024),
  type: z.string().min(1).max(255),
  last_modified: z.number().int().optional(),
});

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function POST(req: Request, context: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await context.params;
  const body = bodySchema.parse(await req.json());
  const db = createServiceSupabase();

  const { data: project, error: projectError } = await withRetry(() =>
    db.from("projects").select("id,owner_clerk_id,phase").eq("id", projectId).single(),
  );
  if (projectError || !project || project.owner_clerk_id !== userId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const cleanName = sanitizeFilename(body.name);
  const storagePath = `${projectId}/uploads/${Date.now()}-${randomUUID()}-${cleanName}`;
  const signed = await withRetry(() => db.storage.from("project-assets").createSignedUploadUrl(storagePath));
  if (signed.error || !signed.data) {
    return NextResponse.json({ error: signed.error?.message ?? "Failed to create upload URL" }, { status: 400 });
  }

  const { data: asset, error: assetError } = await withRetry(() =>
    db
      .from("project_assets")
      .insert({
        project_id: projectId,
        phase: project.phase as number,
        kind: "upload",
        storage_bucket: "project-assets",
        storage_path: storagePath,
        filename: cleanName,
        mime_type: body.type,
        size_bytes: body.size,
        status: "pending",
        metadata: { last_modified: body.last_modified ?? null },
        created_by: userId,
      })
      .select("id")
      .single(),
  );

  if (assetError || !asset) {
    return NextResponse.json({ error: assetError?.message ?? "Failed to register asset row" }, { status: 400 });
  }

  await recordProjectEvent(db, {
    projectId,
    eventType: "asset.upload_requested",
    message: `Upload URL issued for asset ${cleanName}`,
    data: {
      asset_id: asset.id,
      filename: cleanName,
      mime_type: body.type,
      size_bytes: body.size,
    },
    agentKey: "system",
  });

  return NextResponse.json({
    assetId: asset.id,
    bucket: "project-assets",
    path: storagePath,
    token: signed.data.token,
  });
}
