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
    db.from("projects").select("id, owner_clerk_id").eq("id", projectId).single(),
  );

  if (projectError || !project || project.owner_clerk_id !== userId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { data: tasks, error: tasksError } = await withRetry(() =>
    db
      .from("tasks")
      .select("agent,description,status,detail,created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(50),
  );

  if (tasksError) {
    return NextResponse.json({ error: tasksError.message }, { status: 400 });
  }

  return NextResponse.json({ tasks: tasks ?? [] });
}
