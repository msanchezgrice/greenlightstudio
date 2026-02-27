import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  const db = createServiceSupabase();

  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const { data: tasks, error } = await withRetry(() =>
    db
      .from("tasks")
      .select("id,agent,description,status,detail,created_at")
      .eq("project_id", projectId)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(40),
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  type TaskRow = {
    id: string;
    agent: string;
    description: string;
    status: string;
    detail: string | null;
    created_at: string;
  };

  const rows = (tasks ?? []) as TaskRow[];
  const running = rows.filter((t) => t.status === "running");

  const agentMap = new Map<string, { agent: string; tasks: TaskRow[]; started_at: string }>();
  for (const task of running) {
    const existing = agentMap.get(task.agent);
    if (existing) {
      existing.tasks.push(task);
    } else {
      agentMap.set(task.agent, { agent: task.agent, tasks: [task], started_at: task.created_at });
    }
  }

  const traceRows = rows
    .filter((t) => t.description.includes("_traces") && t.status === "completed")
    .slice(0, 10);

  const agents = Array.from(agentMap.values()).map((entry) => ({
    agent: entry.agent,
    started_at: entry.started_at,
    tasks: entry.tasks.map((t) => ({
      id: t.id,
      description: t.description,
      detail: t.detail,
      created_at: t.created_at,
    })),
  }));

  const recent = rows
    .filter((t) => t.status === "completed" || t.status === "failed")
    .slice(0, 8)
    .map((t) => ({
      id: t.id,
      agent: t.agent,
      description: t.description,
      status: t.status,
      detail: t.detail,
      created_at: t.created_at,
    }));

  return NextResponse.json({
    running_agents: agents,
    recent_completions: recent,
    traces: traceRows.map((t) => ({ agent: t.agent, detail: t.detail, created_at: t.created_at })),
    polled_at: new Date().toISOString(),
  });
}
