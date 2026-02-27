import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { generateProjectChatReply } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 800;

const postSchema = z.object({
  message: z.string().trim().min(1).max(3000),
});

type ProjectRow = {
  id: string;
  name: string;
  domain: string | null;
  phase: number;
  idea_description: string;
  repo_url: string | null;
  runtime_mode: "shared" | "attached";
  focus_areas: string[] | null;
};

type ChatRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

type TaskRow = {
  agent: string;
  description: string;
  status: string;
  detail: string | null;
  created_at: string;
};

type ApprovalRow = {
  title: string;
  status: string;
  risk: string;
  created_at: string;
};

function truncateForChat(value: unknown, maxLen = 300): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed;
}

function packetSummary(packet: unknown) {
  if (!packet || typeof packet !== "object") {
    return { recommendation: null, summary: null, tagline: null, competitor_analysis: null, market_sizing: null, target_persona: null, mvp_scope: null, reasoning_synopsis: null };
  }

  const record = packet as Record<string, unknown>;
  const recommendation = typeof record.recommendation === "string" ? record.recommendation : null;

  const summary =
    (typeof record.summary === "string" && record.summary.trim()) ? record.summary.trim()
    : (typeof record.elevator_pitch === "string" && record.elevator_pitch.trim()) ? record.elevator_pitch.trim()
    : null;

  const tagline = truncateForChat(record.tagline);

  let competitor_analysis: unknown = null;
  if (Array.isArray(record.competitor_analysis)) {
    competitor_analysis = record.competitor_analysis.slice(0, 5).map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const e = entry as Record<string, unknown>;
      return { name: e.name, positioning: truncateForChat(e.positioning, 120), gap: truncateForChat(e.gap, 120) };
    });
  }

  let market_sizing: unknown = null;
  if (record.market_sizing && typeof record.market_sizing === "object") {
    const ms = record.market_sizing as Record<string, unknown>;
    market_sizing = { tam: truncateForChat(ms.tam, 150), sam: truncateForChat(ms.sam, 150), som: truncateForChat(ms.som, 150) };
  }

  let target_persona: unknown = null;
  if (record.target_persona && typeof record.target_persona === "object") {
    const tp = record.target_persona as Record<string, unknown>;
    target_persona = { name: tp.name, description: truncateForChat(tp.description, 200), pain_points: Array.isArray(tp.pain_points) ? tp.pain_points.slice(0, 5) : null };
  }

  let mvp_scope: unknown = null;
  if (record.mvp_scope && typeof record.mvp_scope === "object") {
    const mvp = record.mvp_scope as Record<string, unknown>;
    mvp_scope = { in_scope: Array.isArray(mvp.in_scope) ? mvp.in_scope.slice(0, 6) : null, deferred: Array.isArray(mvp.deferred) ? mvp.deferred.slice(0, 4) : null };
  }

  let reasoning_synopsis: unknown = null;
  if (record.reasoning_synopsis && typeof record.reasoning_synopsis === "object") {
    const rs = record.reasoning_synopsis as Record<string, unknown>;
    reasoning_synopsis = {
      decision: rs.decision,
      confidence: rs.confidence,
      rationale: Array.isArray(rs.rationale) ? rs.rationale.slice(0, 4) : null,
      risks: Array.isArray(rs.risks) ? rs.risks.slice(0, 4) : null,
      next_actions: Array.isArray(rs.next_actions) ? rs.next_actions.slice(0, 4) : null,
    };
  }

  return { recommendation, summary, tagline, competitor_analysis, market_sizing, target_persona, mvp_scope, reasoning_synopsis };
}

async function loadOwnedProject(projectId: string, userId: string) {
  const db = createServiceSupabase();
  const { data, error } = await withRetry(() =>
    db
      .from("projects")
      .select("id,name,domain,phase,idea_description,repo_url,runtime_mode,focus_areas")
      .eq("id", projectId)
      .eq("owner_clerk_id", userId)
      .maybeSingle(),
  );

  if (error) {
    throw new Error(error.message);
  }

  return (data as ProjectRow | null) ?? null;
}

export async function GET(_: Request, context: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { projectId } = await context.params;
    const project = await loadOwnedProject(projectId, userId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const db = createServiceSupabase();
    const { data, error } = await withRetry(() =>
      db
        .from("project_chat_messages")
        .select("id,role,content,created_at")
        .eq("project_id", projectId)
        .eq("owner_clerk_id", userId)
        .order("created_at", { ascending: true })
        .limit(200),
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const messages = ((data ?? []) as ChatRow[]).map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      created_at: row.created_at,
    }));

    return NextResponse.json({ messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed loading chat history";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request, context: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await context.params;

  try {
    const body = postSchema.parse(await req.json());
    const project = await loadOwnedProject(projectId, userId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const db = createServiceSupabase();

    const { error: insertUserError } = await withRetry(() =>
      db.from("project_chat_messages").insert({
        project_id: projectId,
        owner_clerk_id: userId,
        role: "user",
        content: body.message,
      }),
    );

    if (insertUserError) {
      throw new Error(insertUserError.message);
    }

    const [messagesQuery, packetQuery, tasksQuery, approvalsQuery] = await Promise.all([
      withRetry(() =>
        db
          .from("project_chat_messages")
          .select("id,role,content,created_at")
          .eq("project_id", projectId)
          .eq("owner_clerk_id", userId)
          .order("created_at", { ascending: false })
          .limit(24),
      ),
      withRetry(() =>
        db
          .from("phase_packets")
          .select("phase,confidence,packet")
          .eq("project_id", projectId)
          .order("phase", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
      withRetry(() =>
        db
          .from("tasks")
          .select("agent,description,status,detail,created_at")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(12),
      ),
      withRetry(() =>
        db
          .from("approval_queue")
          .select("title,status,risk,created_at")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(8),
      ),
    ]);

    if (messagesQuery.error) throw new Error(messagesQuery.error.message);
    if (packetQuery.error) throw new Error(packetQuery.error.message);
    if (tasksQuery.error) throw new Error(tasksQuery.error.message);
    if (approvalsQuery.error) throw new Error(approvalsQuery.error.message);

    const messages = ((messagesQuery.data ?? []) as ChatRow[])
      .slice()
      .reverse()
      .map((message) => ({ role: message.role, content: message.content }));

    const latestPacketRow = packetQuery.data as { phase: number; confidence: number; packet: unknown } | null;
    const packetMeta = latestPacketRow
      ? {
          phase: latestPacketRow.phase,
          confidence: latestPacketRow.confidence,
          ...packetSummary(latestPacketRow.packet),
        }
      : null;

    const assistantReply = await generateProjectChatReply({
      project: {
        id: project.id,
        name: project.name,
        domain: project.domain,
        phase: project.phase,
        idea_description: project.idea_description,
        repo_url: project.repo_url,
        runtime_mode: project.runtime_mode,
        focus_areas: project.focus_areas ?? [],
      },
      latestPacket: packetMeta,
      recentTasks: (tasksQuery.data ?? []) as TaskRow[],
      recentApprovals: (approvalsQuery.data ?? []) as ApprovalRow[],
      messages,
    });

    const { data: assistantMessageRow, error: insertAssistantError } = await withRetry(() =>
      db
        .from("project_chat_messages")
        .insert({
          project_id: projectId,
          owner_clerk_id: userId,
          role: "assistant",
          content: assistantReply,
        })
        .select("id,role,content,created_at")
        .single(),
    );

    if (insertAssistantError || !assistantMessageRow) {
      throw new Error(insertAssistantError?.message ?? "Failed to persist assistant response");
    }

    return NextResponse.json({
      message: {
        id: assistantMessageRow.id,
        role: assistantMessageRow.role,
        content: assistantMessageRow.content,
        created_at: assistantMessageRow.created_at,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed sending chat message";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
