import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";

export const dynamic = "force-dynamic";

type TaskRow = {
  id: string;
  agent: string;
  description: string;
  status: string;
  detail: string | null;
  created_at: string;
};

type EventRow = {
  id: string;
  job_id: string;
  type: string;
  message: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
};

function normalizeAgentKey(agent: string | null | undefined) {
  if (!agent) return "system";
  const key = agent.trim();
  const aliases: Record<string, string> = {
    ceo: "ceo_agent",
    research: "research_agent",
    design: "design_agent",
    engineering: "engineering",
    night_shift: "night_shift",
    outreach: "outreach_agent",
    system: "system",
  };
  return aliases[key] ?? key;
}

function truncate(value: string, max = 220) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function formatEventTrace(event: EventRow) {
  const rawMessage = (event.message ?? "").trim();
  const cleanMessage = rawMessage.replace(/\s+/g, " ").trim();

  if (event.type === "tool_call") {
    const eventData = (event.data ?? {}) as Record<string, unknown>;
    const toolName =
      typeof eventData.tool === "string" && eventData.tool.trim().length > 0
        ? eventData.tool.trim()
        : cleanMessage.replace(/^Using\s+/i, "").trim();
    return `Tool: ${toolName || "unknown"}`;
  }

  if (event.type === "status") {
    return `Status: ${cleanMessage || "updated"}`;
  }

  if (event.type === "artifact") {
    return `Artifact: ${cleanMessage || "generated"}`;
  }

  if (event.type === "done") {
    return "Done";
  }

  if (event.type === "delta") {
    if (!cleanMessage) return null;
    return `Thinking: ${truncate(cleanMessage, 140)}`;
  }

  if (event.type === "log") {
    if (!cleanMessage) return null;
    return truncate(cleanMessage, 180);
  }

  return null;
}

export async function GET(_: Request, context: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await context.params;
  const db = createServiceSupabase();

  const { data: project, error: projectError } = await withRetry(() =>
    db
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("owner_clerk_id", userId)
      .maybeSingle(),
  );

  if (projectError) {
    return NextResponse.json({ error: projectError.message }, { status: 400 });
  }
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const [tasksResult, eventsResult] = await Promise.all([
    withRetry(() =>
      db
        .from("tasks")
        .select("id,agent,description,status,detail,created_at")
        .eq("project_id", projectId)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(40),
    ),
    withRetry(() =>
      db
        .from("agent_job_events")
        .select("id,job_id,type,message,data,created_at")
        .eq("project_id", projectId)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(60),
    ),
  ]);

  if (tasksResult.error) {
    return NextResponse.json({ error: tasksResult.error.message }, { status: 400 });
  }
  if (eventsResult.error) {
    return NextResponse.json({ error: eventsResult.error.message }, { status: 400 });
  }

  const rows = (tasksResult.data ?? []) as TaskRow[];
  const running = rows.filter((task) => task.status === "running");

  const agentMap = new Map<string, { agent: string; tasks: TaskRow[]; started_at: string }>();
  for (const task of running) {
    const existing = agentMap.get(task.agent);
    if (existing) {
      existing.tasks.push(task);
    } else {
      agentMap.set(task.agent, { agent: task.agent, tasks: [task], started_at: task.created_at });
    }
  }

  const eventRows = (eventsResult.data ?? []) as EventRow[];
  const jobIds = Array.from(new Set(eventRows.map((event) => event.job_id).filter(Boolean)));
  let jobAgentMap = new Map<string, string>();

  if (jobIds.length > 0) {
    const { data: jobs, error: jobError } = await withRetry(() =>
      db
        .from("agent_jobs")
        .select("id,agent_key")
        .in("id", jobIds),
    );
    if (jobError) {
      return NextResponse.json({ error: jobError.message }, { status: 400 });
    }
    jobAgentMap = new Map((jobs ?? []).map((job) => [String(job.id), normalizeAgentKey(String(job.agent_key ?? ""))]));
  }

  const eventTraces = eventRows
    .map((event) => {
      const eventData = (event.data ?? {}) as Record<string, unknown>;
      const agentFromData =
        typeof eventData.agent_key === "string"
          ? normalizeAgentKey(eventData.agent_key)
          : typeof eventData.agent === "string"
            ? normalizeAgentKey(eventData.agent)
            : null;
      const agent = agentFromData ?? jobAgentMap.get(event.job_id) ?? null;
      const detail = formatEventTrace(event);
      if (!agent || !detail) return null;
      return { agent, detail, created_at: event.created_at };
    })
    .filter((row): row is { agent: string; detail: string; created_at: string } => Boolean(row));

  const taskTraces = rows
    .filter((task) => task.description.includes("_trace") && typeof task.detail === "string" && task.detail.trim().length > 0)
    .map((task) => ({
      agent: normalizeAgentKey(task.agent),
      detail: task.detail as string,
      created_at: task.created_at,
    }));

  const traces = [...eventTraces, ...taskTraces]
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    .slice(0, 30);

  const agents = Array.from(agentMap.values()).map((entry) => ({
    agent: entry.agent,
    started_at: entry.started_at,
    tasks: entry.tasks
      .filter((task) => !task.description.includes("_trace"))
      .map((task) => ({
        id: task.id,
        description: task.description,
        detail: task.detail,
        created_at: task.created_at,
      })),
  }));

  const recent = rows
    .filter((task) => task.status === "completed" || task.status === "failed")
    .slice(0, 8)
    .map((task) => ({
      id: task.id,
      agent: task.agent,
      description: task.description,
      status: task.status,
      detail: task.detail,
      created_at: task.created_at,
    }));

  return NextResponse.json({
    running_agents: agents,
    recent_completions: recent,
    traces,
    polled_at: new Date().toISOString(),
  });
}
