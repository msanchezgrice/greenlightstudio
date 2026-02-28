import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { JOB_TYPES, AGENT_KEYS, PRIORITY } from "@/lib/jobs/constants";
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

    const { data: userMsg } = await withRetry(() =>
      db
        .from("project_chat_messages")
        .select("id")
        .eq("project_id", projectId)
        .eq("owner_clerk_id", userId)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(1)
        .single(),
    );

    const userMessageId = (userMsg?.id as string | undefined) ?? crypto.randomUUID();

    let jobId: string | null = null;
    try {
      jobId = await enqueueJob({
        projectId,
        jobType: JOB_TYPES.CHAT_REPLY,
        agentKey: AGENT_KEYS.CEO,
        payload: {
          projectId,
          ownerClerkId: userId,
          userMessageId,
          message: body.message,
        },
        idempotencyKey: `chat:${projectId}:${userMessageId}`,
        priority: PRIORITY.USER_INTERACTIVE,
      });
    } catch {}

    after(async () => {
      try {
        const db2 = createServiceSupabase();
        const [packetRes, tasksRes, approvalsRes, messagesRes] = await Promise.all([
          db2.from("phase_packets").select("phase,confidence,packet,packet_data").eq("project_id", projectId)
            .order("created_at", { ascending: false }).limit(1).maybeSingle(),
          db2.from("tasks").select("agent,description,status,detail,created_at").eq("project_id", projectId)
            .order("created_at", { ascending: false }).limit(10),
          db2.from("approval_queue").select("title,status,risk,created_at").eq("project_id", projectId)
            .order("created_at", { ascending: false }).limit(10),
          db2.from("project_chat_messages").select("id,role,content,created_at").eq("project_id", projectId)
            .eq("owner_clerk_id", userId).order("created_at", { ascending: true }).limit(50),
        ]);

        const packetPayload = packetRes.data
          ? ((packetRes.data.packet_data ?? packetRes.data.packet) as Record<string, unknown> | null)
          : null;

        const reply = await generateProjectChatReply({
          project: { ...project!, focus_areas: project!.focus_areas ?? [] },
          latestPacket: packetPayload
            ? {
                phase: Number(packetRes.data?.phase ?? project!.phase),
                confidence: Number(packetRes.data?.confidence ?? 0),
                recommendation:
                  typeof packetPayload.recommendation === "string" ? packetPayload.recommendation : null,
                summary: typeof packetPayload.summary === "string" ? packetPayload.summary : null,
                tagline: typeof packetPayload.tagline === "string" ? packetPayload.tagline : null,
                competitor_analysis: packetPayload.competitor_analysis ?? null,
                market_sizing: packetPayload.market_sizing ?? null,
                target_persona: packetPayload.target_persona ?? null,
                mvp_scope: packetPayload.mvp_scope ?? null,
                reasoning_synopsis: packetPayload.reasoning_synopsis ?? null,
              }
            : null,
          recentTasks: (tasksRes.data ?? []) as { agent: string; description: string; status: string; detail: string | null; created_at: string }[],
          recentApprovals: (approvalsRes.data ?? []) as { title: string; status: string; risk: string; created_at: string }[],
          messages: ((messagesRes.data ?? []) as { id: string; role: string; content: string; created_at: string }[]).map(m => ({
            role: m.role as "user" | "assistant" | "system",
            content: m.content,
          })),
        });

        await db2.from("project_chat_messages").insert({
          project_id: projectId,
          owner_clerk_id: userId,
          role: "assistant",
          content: reply,
        });

        if (jobId) {
          await db2.from("agent_job_events").insert({
            project_id: projectId,
            job_id: jobId,
            type: "status",
            message: "completed",
          });
          await db2.rpc("complete_agent_job", {
            p_job_id: jobId,
            p_status: "completed",
            p_error: null,
          });
        }
      } catch (err) {
        console.error("[chat] direct reply failed:", err);
      }
    });

    return NextResponse.json({
      ok: true,
      ...(jobId ? { jobId, streaming: true } : {}),
      userMessageId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed sending chat message";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
