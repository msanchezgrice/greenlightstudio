import { auth } from "@clerk/nextjs/server";
import { createServiceSupabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { batchId } = await params;
  const db = createServiceSupabase();

  // Get batch
  const { data: batch } = await db.from("batches").select("*").eq("id", batchId).single();
  if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Get projects in batch
  const { data: projects } = await db
    .from("projects")
    .select("id,name,domain,phase")
    .eq("batch_id", batchId)
    .order("created_at");

  // Get latest tasks and packets for these projects
  const projectIds = (projects ?? []).map((p: { id: string }) => p.id);

  let packets: Array<{ project_id: string; confidence: number | null }> = [];
  let tasks: Array<{ project_id: string; status: string; agent: string | null; description: string | null }> = [];
  if (projectIds.length) {
    const [packetsRes, tasksRes] = await Promise.all([
      db.from("phase_packets").select("project_id,confidence").in("project_id", projectIds),
      db
        .from("tasks")
        .select("project_id,status,agent,description")
        .in("project_id", projectIds)
        .order("created_at", { ascending: false }),
    ]);
    packets = packetsRes.data ?? [];
    tasks = tasksRes.data ?? [];
  }

  return NextResponse.json({ batch, projects: projects ?? [], packets, tasks });
}
