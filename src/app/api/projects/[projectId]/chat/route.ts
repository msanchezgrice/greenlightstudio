import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { JOB_TYPES, AGENT_KEYS, PRIORITY } from "@/lib/jobs/constants";
import { recordProjectEvent } from "@/lib/project-events";

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

    const { data: insertedUserMsg, error: insertUserError } = await withRetry(() =>
      db
        .from("project_chat_messages")
        .insert({
          project_id: projectId,
          owner_clerk_id: userId,
          role: "user",
          content: body.message,
        })
        .select("id")
        .single(),
    );

    if (insertUserError) {
      throw new Error(insertUserError.message);
    }
    const userMessageId = (insertedUserMsg?.id as string | undefined) ?? crypto.randomUUID();

    await recordProjectEvent(db, {
      projectId,
      eventType: "chat.user_message",
      message: "User sent message in project chat",
      data: {
        user_message_id: userMessageId,
        owner_clerk_id: userId,
        content_preview: body.message.slice(0, 220),
      },
      agentKey: "ceo",
    });

    const jobId = await enqueueJob({
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
      priority: PRIORITY.REALTIME,
    });

    return NextResponse.json({
      ok: true,
      jobId,
      streaming: true,
      userMessageId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed sending chat message";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
