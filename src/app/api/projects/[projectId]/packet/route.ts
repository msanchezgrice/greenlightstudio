import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase";

export async function GET(req: Request, context: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await context.params;
  const url = new URL(req.url);
  const requestedPhase = Number(url.searchParams.get("phase") ?? "0");
  if (!Number.isInteger(requestedPhase) || requestedPhase < 0 || requestedPhase > 3) {
    return NextResponse.json({ error: "phase must be an integer between 0 and 3" }, { status: 400 });
  }

  const db = createServiceSupabase();
  const { data: project } = await db.from("projects").select("owner_clerk_id").eq("id", projectId).single();
  if (!project || project.owner_clerk_id !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await db
    .from("phase_packets")
    .select("phase,packet,confidence,created_at")
    .eq("project_id", projectId)
    .eq("phase", requestedPhase)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}
