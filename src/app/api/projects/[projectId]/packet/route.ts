import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase";

export async function GET(_: Request, context: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await context.params;

  const db = createServiceSupabase();
  const { data: project } = await db.from("projects").select("owner_clerk_id").eq("id", projectId).single();
  if (!project || project.owner_clerk_id !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await db.from("phase_packets").select("packet, confidence").eq("project_id", projectId).eq("phase", 0).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}
