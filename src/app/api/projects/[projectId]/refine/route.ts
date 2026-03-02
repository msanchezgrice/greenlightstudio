import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { recordProjectEvent } from "@/lib/project-events";

const bodySchema = z.object({
  phase: z.number().int().min(0).max(3).optional(),
  guidance: z.string().trim().min(8).max(2000),
  assetId: z.string().uuid().optional().nullable(),
});

export async function POST(req: Request, context: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await context.params;
  const body = bodySchema.parse(await req.json());
  const targetPhase = Number.isFinite(body.phase) ? Number(body.phase) : null;

  const db = createServiceSupabase();

  const { data: project } = await db
    .from("projects")
    .select("id,name,phase,owner_clerk_id")
    .eq("id", projectId)
    .eq("owner_clerk_id", userId)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const phaseForRefine = targetPhase ?? Math.max(0, Math.min(3, Number(project.phase ?? 0)));

  const { data: packetRow, error: packetError } = await db
    .from("phase_packets")
    .select("id,packet,packet_data")
    .eq("project_id", projectId)
    .eq("phase", phaseForRefine)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (packetError || !packetRow) {
    return NextResponse.json({ error: `No Phase ${phaseForRefine} packet found to refine.` }, { status: 400 });
  }

  const { data: existing } = await db
    .from("approval_queue")
    .select("id")
    .eq("project_id", projectId)
    .eq("phase", phaseForRefine)
    .eq("action_type", "refine_phase_assets")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return NextResponse.json({ ok: true, approvalId: existing.id, existing: true });
  }

  const payload = {
    source: "workspace_refine",
    target_phase: phaseForRefine,
    asset_id: body.assetId ?? null,
    improvement_guidance: body.guidance,
    user_message: body.guidance,
    phase_packet: (packetRow.packet_data ?? packetRow.packet) as unknown,
  };

  const { data: inserted, error: insertError } = await db
    .from("approval_queue")
    .insert({
      project_id: projectId,
      packet_id: packetRow.id,
      phase: phaseForRefine,
      type: "execution",
      title: `Refine Phase ${phaseForRefine} Assets`,
      description: `Refinement requested: ${body.guidance.slice(0, 180)}`,
      risk: "low",
      risk_level: "low",
      action_type: "refine_phase_assets",
      agent_source: "ceo_agent",
      payload,
      status: "pending",
    })
    .select("id")
    .single();

  if (insertError || !inserted?.id) {
    return NextResponse.json({ error: insertError?.message ?? "Failed to queue refine request" }, { status: 400 });
  }

  await recordProjectEvent(db, {
    projectId,
    eventType: "approval.refine_requested",
    message: `Refinement requested for phase ${phaseForRefine}`,
    data: {
      approval_id: inserted.id,
      phase: phaseForRefine,
      asset_id: body.assetId ?? null,
      guidance_preview: body.guidance.slice(0, 220),
    },
    agentKey: "ceo",
  });

  return NextResponse.json({ ok: true, approvalId: inserted.id, existing: false });
}
