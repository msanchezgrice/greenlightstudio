import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { loadMemory, writeMemory, formatMemoryForPrompt } from "../memory";
import { generateProjectChatReply } from "@/lib/agent";

export async function handleChatReply(
  db: SupabaseClient,
  job: { id: string; project_id: string; payload: Record<string, unknown> }
) {
  const payload = job.payload ?? {};
  const projectId = (payload.projectId as string) ?? job.project_id;
  const ownerClerkId = payload.ownerClerkId as string;
  const message = payload.message as string;

  const memories = await loadMemory(db, projectId);
  const memoryContext = formatMemoryForPrompt(memories);

  const project = await db
    .from("projects")
    .select("id,name,domain,phase,idea_description,repo_url,runtime_mode,focus_areas")
    .eq("id", projectId)
    .single();
  if (project.error || !project.data) throw new Error("Project not found");

  const [messagesQuery, packetQuery, tasksQuery, approvalsQuery] = await Promise.all([
    db
      .from("project_chat_messages")
      .select("id,role,content,created_at")
      .eq("project_id", projectId)
      .eq("owner_clerk_id", ownerClerkId)
      .order("created_at", { ascending: false })
      .limit(24),
    db
      .from("phase_packets")
      .select("phase,confidence,packet")
      .eq("project_id", projectId)
      .order("phase", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("tasks")
      .select("agent,description,status,detail,created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(12),
    db
      .from("approval_queue")
      .select("title,status,risk,created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  type ChatRow = { role: string; content: string };
  type PacketRow = { phase: number; confidence: number; packet: unknown };

  const messages = ((messagesQuery.data ?? []) as ChatRow[])
    .slice()
    .reverse()
    .map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }));

  const latestPacketRow = packetQuery.data as PacketRow | null;

  const enrichedMessage = memoryContext
    ? `[Project memory context]\n${memoryContext}\n\n[User message]\n${message}`
    : message;

  messages.push({ role: "user", content: enrichedMessage });

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "log",
    message: "Generating reply",
  });

  const reply = await generateProjectChatReply({
    project: {
      id: project.data.id as string,
      name: project.data.name as string,
      domain: (project.data.domain as string | null) ?? null,
      phase: project.data.phase as number,
      idea_description: project.data.idea_description as string,
      repo_url: (project.data.repo_url as string | null) ?? null,
      runtime_mode: project.data.runtime_mode as "shared" | "attached",
      focus_areas: (project.data.focus_areas as string[]) ?? [],
    },
    latestPacket: latestPacketRow
      ? {
          phase: latestPacketRow.phase,
          confidence: latestPacketRow.confidence,
          recommendation: null,
          summary: null,
        }
      : null,
    recentTasks: (tasksQuery.data ?? []) as Array<{
      agent: string;
      description: string;
      status: string;
      detail: string | null;
      created_at: string;
    }>,
    recentApprovals: (approvalsQuery.data ?? []) as Array<{
      title: string;
      status: string;
      risk: string;
      created_at: string;
    }>,
    messages,
  });

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "delta",
    message: reply,
  });

  const { error: insertErr } = await db.from("project_chat_messages").insert({
    project_id: projectId,
    owner_clerk_id: ownerClerkId,
    role: "assistant",
    content: reply,
  });
  if (insertErr) throw new Error(insertErr.message);

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "artifact",
    message: "Chat reply delivered",
  });

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "done",
    message: "complete",
  });

  await writeMemory(db, projectId, job.id, [
    {
      category: "context",
      key: "last_chat_topic",
      value: message.slice(0, 200),
      agentKey: "ceo",
    },
  ]);
}
