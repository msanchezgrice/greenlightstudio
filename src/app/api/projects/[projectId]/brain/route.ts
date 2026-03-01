import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { ensureProjectBrainDocument } from "@/lib/brain";
import { recordProjectEvent, enqueueBrainRefresh } from "@/lib/project-events";

const missionSchema = z.object({
  mission: z.string().trim().min(20).max(20_000),
});

async function loadOwnedProject(db: ReturnType<typeof createServiceSupabase>, projectId: string, userId: string) {
  const { data } = await db
    .from("projects")
    .select("id,name,owner_clerk_id")
    .eq("id", projectId)
    .eq("owner_clerk_id", userId)
    .maybeSingle();

  return data ?? null;
}

export async function GET(_: Request, context: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await context.params;
  const db = createServiceSupabase();

  const project = await loadOwnedProject(db, projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  await ensureProjectBrainDocument(db, projectId);

  const { data: brain, error } = await db
    .from("project_brain_documents")
    .select("project_id,mission_markdown,memory_markdown,memory_version,last_event_id,updated_at")
    .eq("project_id", projectId)
    .single();

  if (error || !brain) {
    return NextResponse.json({ error: error?.message ?? "Brain not found" }, { status: 404 });
  }

  return NextResponse.json({
    project_id: brain.project_id,
    mission: brain.mission_markdown,
    memory: brain.memory_markdown,
    memory_version: brain.memory_version,
    last_event_id: brain.last_event_id,
    updated_at: brain.updated_at,
  });
}

export async function PUT(req: Request, context: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await context.params;
  const db = createServiceSupabase();

  const project = await loadOwnedProject(db, projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const body = missionSchema.parse(await req.json());

  await ensureProjectBrainDocument(db, projectId);

  const { error } = await db
    .from("project_brain_documents")
    .update({
      mission_markdown: body.mission,
      updated_at: new Date().toISOString(),
    })
    .eq("project_id", projectId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await recordProjectEvent(db, {
    projectId,
    eventType: "brain.mission_updated",
    message: "Company mission updated by user",
    data: {
      updated_by: userId,
      project_name: project.name,
    },
    agentKey: "ceo",
    refreshReason: "manual",
  });

  await enqueueBrainRefresh({
    projectId,
    reason: "manual",
  });

  return NextResponse.json({ ok: true });
}
