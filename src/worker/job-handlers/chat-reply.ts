import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { loadMemory, writeMemory, formatMemoryForPrompt, type MemoryEntry } from "../memory";
import { assembleCompanyContext, companyContextToMarkdown } from "@/lib/company-context";
import { recordProjectEvent } from "@/lib/project-events";
import {
  detectChatExecutionIntent,
  executeAgentQuery,
  type ChatExecutionActionType,
  type StreamEvent,
} from "@/lib/agent";

type ActionRule = {
  requiredPhase: 1 | 2 | 3;
  title: string;
  risk: "high" | "medium" | "low";
};

type ChatAutomationOutcome = {
  status: "none" | "ignored" | "blocked" | "existing" | "queued";
  actionType: ChatExecutionActionType | null;
  summary: string;
  approvalId?: string;
};

const ACTION_RULES: Record<ChatExecutionActionType, ActionRule> = {
  deploy_landing_page: {
    requiredPhase: 1,
    title: "Deploy Shared Runtime Landing Page",
    risk: "medium",
  },
  send_welcome_email_sequence: {
    requiredPhase: 1,
    title: "Send Welcome Email Sequence",
    risk: "low",
  },
  send_phase2_lifecycle_email: {
    requiredPhase: 2,
    title: "Send Phase 2 Lifecycle Email",
    risk: "low",
  },
  activate_meta_ads_campaign: {
    requiredPhase: 2,
    title: "Activate Meta Ads Campaign",
    risk: "high",
  },
  trigger_phase3_repo_workflow: {
    requiredPhase: 3,
    title: "Trigger Phase 3 Repo Workflow",
    risk: "high",
  },
  trigger_phase3_deploy: {
    requiredPhase: 3,
    title: "Trigger Phase 3 Deploy",
    risk: "high",
  },
};

const EXECUTION_VERB_REGEX =
  /\b(remake|rebuild|redo|regenerate|deploy|redeploy|publish|launch|ship|send|resend|activate|trigger|run|make|change|update|edit|tweak)\b/i;
const EXECUTION_OBJECT_REGEX =
  /\b(landing page|landing|button|cta|color|purple|headline|subheadline|copy|hero|style|design|welcome email|email sequence|lifecycle email|ads|campaign|repo workflow|workflow|deploy|go live)\b/i;

function shouldEvaluateExecutionIntent(message: string) {
  const trimmed = message.trim();
  if (trimmed.length < 6) return false;
  if (!EXECUTION_VERB_REGEX.test(trimmed)) return false;
  return EXECUTION_OBJECT_REGEX.test(trimmed);
}

function isTruthyFlag(value: unknown) {
  return value === true;
}

function isPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function preconditionFailure(
  actionType: ChatExecutionActionType,
  project: {
    runtime_mode: "shared" | "attached";
    repo_url: string | null;
    permissions: Record<string, unknown> | null;
  },
) {
  const permissions = project.permissions ?? {};

  if (actionType === "deploy_landing_page" && project.runtime_mode !== "shared") {
    return "Landing deploy action requires shared runtime mode.";
  }
  if (
    actionType === "send_welcome_email_sequence" ||
    actionType === "send_phase2_lifecycle_email"
  ) {
    if (!isTruthyFlag(permissions.email_send)) {
      return "Email sending is disabled in project permissions.";
    }
  }
  if (actionType === "activate_meta_ads_campaign") {
    if (!isTruthyFlag(permissions.ads_enabled)) {
      return "Ads are disabled in project permissions.";
    }
    if (!isPositiveNumber(permissions.ads_budget_cap)) {
      return "Ads budget cap must be greater than 0.";
    }
  }
  if (actionType === "trigger_phase3_repo_workflow") {
    if (!project.repo_url) {
      return "Repository workflow trigger requires an attached repository URL.";
    }
    if (!isTruthyFlag(permissions.repo_write)) {
      return "Repo write permission is disabled.";
    }
  }
  if (actionType === "trigger_phase3_deploy" && !isTruthyFlag(permissions.deploy)) {
    return "Deploy permission is disabled.";
  }

  return null;
}

function automationSystemMessage(outcome: ChatAutomationOutcome) {
  if (outcome.status === "queued") {
    return `Action request queued for approval: ${outcome.actionType}. Check Inbox to approve execution.`;
  }
  if (outcome.status === "existing") {
    return `Action request already pending: ${outcome.actionType}. Existing approval remains in Inbox.`;
  }
  if (outcome.status === "blocked") {
    return `Action request not queued: ${outcome.summary}`;
  }
  return null;
}

async function evaluateAndQueueChatAction(params: {
  db: SupabaseClient;
  projectId: string;
  ownerClerkId: string;
  message: string;
  project: {
    id: string;
    name: string;
    phase: number;
    runtime_mode: "shared" | "attached";
    repo_url: string | null;
    permissions: Record<string, unknown> | null;
  };
  latestPacketPhase: number | null;
}) {
  const intent = await detectChatExecutionIntent({
    project_id: params.projectId,
    project_name: params.project.name,
    phase: params.project.phase,
    runtime_mode: params.project.runtime_mode,
    repo_url: params.project.repo_url,
    permissions: (params.project.permissions ?? {}) as {
      repo_write?: boolean;
      deploy?: boolean;
      ads_enabled?: boolean;
      ads_budget_cap?: number;
      email_send?: boolean;
    },
    latest_packet_phase: params.latestPacketPhase,
    user_message: params.message,
  });

  if (intent.decision !== "queue_execution_approval" || !intent.action_type) {
    return {
      status: "none",
      actionType: null,
      summary: "No execution action requested.",
    } as ChatAutomationOutcome;
  }

  if (intent.confidence < 70) {
    return {
      status: "ignored",
      actionType: intent.action_type,
      summary: `Skipped due to low intent confidence (${intent.confidence}).`,
    } as ChatAutomationOutcome;
  }

  const actionType = intent.action_type;
  const rule = ACTION_RULES[actionType];
  const blockReason = preconditionFailure(actionType, params.project);
  if (blockReason) {
    return {
      status: "blocked",
      actionType,
      summary: blockReason,
    } as ChatAutomationOutcome;
  }

  const existingApproval = await params.db
    .from("approval_queue")
    .select("id")
    .eq("project_id", params.projectId)
    .eq("action_type", actionType)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingApproval.error) {
    throw new Error(existingApproval.error.message);
  }
  if (existingApproval.data?.id) {
    return {
      status: "existing",
      actionType,
      approvalId: existingApproval.data.id as string,
      summary: "A pending approval for this action already exists.",
    } as ChatAutomationOutcome;
  }

  const packetLookup = await params.db
    .from("phase_packets")
    .select("id,phase,packet,packet_data")
    .eq("project_id", params.projectId)
    .eq("phase", rule.requiredPhase)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (packetLookup.error) {
    throw new Error(packetLookup.error.message);
  }
  if (!packetLookup.data) {
    return {
      status: "blocked",
      actionType,
      summary: `No Phase ${rule.requiredPhase} packet found. Generate Phase ${rule.requiredPhase} first.`,
    } as ChatAutomationOutcome;
  }

  const packetPayload = (packetLookup.data.packet_data ?? packetLookup.data.packet) as unknown;
  const { data: inserted, error: insertError } = await params.db
    .from("approval_queue")
    .insert({
      project_id: params.projectId,
      packet_id: packetLookup.data.id,
      phase: rule.requiredPhase,
      type: "execution",
      title: intent.title ?? rule.title,
      description: intent.description ?? `Requested via chat: ${params.message.slice(0, 180)}`,
      risk: rule.risk,
      risk_level: rule.risk,
      action_type: actionType,
      agent_source: "ceo_chat",
      payload: {
        phase_packet: packetPayload,
        source: "chat",
        requested_by: params.ownerClerkId,
        requested_at: new Date().toISOString(),
        user_message: params.message.slice(0, 1200),
        improvement_guidance: params.message.slice(0, 1200),
        rationale: intent.rationale,
      },
      status: "pending",
    })
    .select("id")
    .single();
  if (insertError) {
    throw new Error(insertError.message);
  }

  return {
    status: "queued",
    actionType,
    approvalId: inserted.id as string,
    summary: "Execution approval queued from chat request.",
  } as ChatAutomationOutcome;
}

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
  const companyContext = await assembleCompanyContext(db, projectId);
  const companyContextMarkdown = companyContextToMarkdown(companyContext);

  const project = await db
    .from("projects")
    .select("id,name,domain,phase,idea_description,repo_url,runtime_mode,focus_areas,permissions")
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
      .limit(16),
    db
      .from("phase_packets")
      .select("id,phase,confidence,packet,packet_data")
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
      .limit(8),
    db
      .from("approval_queue")
      .select("title,status,risk,created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  type ChatRow = { role: string; content: string };
  type PacketRow = { id: string; phase: number; confidence: number; packet: unknown; packet_data: unknown };

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

  let automationOutcome: ChatAutomationOutcome = {
    status: "none",
    actionType: null,
    summary: "No execution action requested.",
  };

  if (shouldEvaluateExecutionIntent(message)) {
    await emitJobEvent(db, {
      projectId,
      jobId: job.id,
      type: "log",
      message: "Evaluating execution intent",
    });

    try {
      automationOutcome = await evaluateAndQueueChatAction({
        db,
        projectId,
        ownerClerkId,
        message,
        project: {
          id: project.data.id as string,
          name: project.data.name as string,
          phase: project.data.phase as number,
          runtime_mode: project.data.runtime_mode as "shared" | "attached",
          repo_url: (project.data.repo_url as string | null) ?? null,
          permissions: (project.data.permissions as Record<string, unknown> | null) ?? null,
        },
        latestPacketPhase: latestPacketRow?.phase ?? null,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Intent evaluation failed";
      automationOutcome = {
        status: "ignored",
        actionType: null,
        summary: detail,
      };
      await emitJobEvent(db, {
        projectId,
        jobId: job.id,
        type: "log",
        message: `Execution intent check failed: ${detail.slice(0, 180)}`,
      });
    }
  }

  if (automationOutcome.status === "queued") {
    await emitJobEvent(db, {
      projectId,
      jobId: job.id,
      type: "artifact",
      message: `Approval queued: ${automationOutcome.actionType}`,
      data: { approval_id: automationOutcome.approvalId, action_type: automationOutcome.actionType },
    });
  }

  if (automationOutcome.status === "existing" || automationOutcome.status === "blocked") {
    await emitJobEvent(db, {
      projectId,
      jobId: job.id,
      type: "log",
      message: automationOutcome.summary,
      data: { action_type: automationOutcome.actionType, status: automationOutcome.status },
    });
  }

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "log",
    message: "Generating reply",
  });

  const promptContext = {
    project: {
      id: project.data.id as string,
      name: project.data.name as string,
      domain: (project.data.domain as string | null) ?? null,
      phase: project.data.phase as number,
      idea_description: (project.data.idea_description as string).slice(0, 500),
      repo_url: (project.data.repo_url as string | null) ?? null,
      runtime_mode: project.data.runtime_mode as "shared" | "attached",
      focus_areas: (project.data.focus_areas as string[]) ?? [],
    },
    latestPacket: latestPacketRow
      ? {
        phase: latestPacketRow.phase,
        confidence: latestPacketRow.confidence,
        packet_excerpt: JSON.stringify(latestPacketRow.packet_data ?? latestPacketRow.packet).slice(0, 1600),
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
    companyMission: companyContext.mission_markdown,
    companyMemory: companyContext.memory_markdown,
    companyKpis: companyContext.kpis,
    companyDeltaEvents: companyContext.delta_events.slice(0, 20),
    chatAutomation: automationOutcome,
    messages: messages.slice(-8),
  };

  const prompt = `You are the Startup Machine CEO chat assistant.

Return ONLY the assistant's plain-text reply to the latest user message.

Behavior rules:
- Ground every answer in this project's real context (packet, tasks, approvals, and prior messages).
- Keep tone concise and operational.
- If information is missing, say exactly what is missing and how to get it.
- If chatAutomation.status is "queued" or "existing", acknowledge it clearly in the first sentence and tell user to use Inbox.
- If chatAutomation.status is "blocked", explain the exact blocker and the concrete prerequisite.
- Reply in <= 140 words unless the user explicitly asks for more.
- No markdown code fences.

Project context:
${JSON.stringify(promptContext, null, 2)}`;

  const promptWithCompanyContext = `${prompt}

[Company Context Snapshot]
${companyContextMarkdown}
`;

  let reply = "";
  let pendingDelta = "";
  let lastDeltaFlushMs = Date.now();
  const flushDelta = async (force = false) => {
    if (!pendingDelta) return;
    const now = Date.now();
    if (!force && pendingDelta.length < 24 && now - lastDeltaFlushMs < 90) return;
    const chunk = pendingDelta;
    pendingDelta = "";
    lastDeltaFlushMs = now;
    await emitJobEvent(db, {
      projectId,
      jobId: job.id,
      type: "delta",
      message: chunk,
    });
  };

  const hooks = {
    onStreamEvent: async (event: StreamEvent) => {
      if (event.type === "text_delta") {
        reply += event.text;
        pendingDelta += event.text;
        await flushDelta(false);
        return;
      }
      if (event.type === "tool_use") {
        await flushDelta(true);
        await emitJobEvent(db, {
          projectId,
          jobId: job.id,
          type: "tool_call",
          message: `Using ${event.tool}`,
          data: { tool: event.tool },
        });
        return;
      }
      if (event.type === "done") {
        await flushDelta(true);
      }
    },
  };

  const fullReply = await executeAgentQuery(
    projectId,
    ownerClerkId,
    promptWithCompanyContext,
    "chat",
    "chat",
    hooks
  );

  await flushDelta(true);
  if (!reply.trim()) {
    reply = fullReply.trim();
    if (reply) {
      await emitJobEvent(db, {
        projectId,
        jobId: job.id,
        type: "delta",
        message: reply,
      });
    }
  }
  if (!reply.trim()) {
    throw new Error("Chat reply was empty");
  }

  const { error: insertErr } = await db.from("project_chat_messages").insert({
    project_id: projectId,
    owner_clerk_id: ownerClerkId,
    role: "assistant",
    content: reply.trim(),
  });
  if (insertErr) throw new Error(insertErr.message);

  await recordProjectEvent(db, {
    projectId,
    eventType: "chat.assistant_reply",
    message: "CEO agent replied in project chat",
    data: {
      owner_clerk_id: ownerClerkId,
      reply_preview: reply.trim().slice(0, 220),
      job_id: job.id,
    },
    agentKey: "ceo",
  });

  const systemMessage = automationSystemMessage(automationOutcome);
  if (systemMessage) {
    try {
      await db.from("project_chat_messages").insert({
        project_id: projectId,
        owner_clerk_id: ownerClerkId,
        role: "system",
        content: systemMessage,
      });
    } catch {
      // Non-fatal: chat reply should still complete even if system note insert fails.
    }
  }

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

  const memoryRows: MemoryEntry[] = [
    {
      category: "context",
      key: "last_chat_topic",
      value: message.slice(0, 200),
      agentKey: "ceo",
    },
  ];
  if (automationOutcome.status === "queued" || automationOutcome.status === "existing") {
    memoryRows.push({
      category: "learning",
      key: `chat_action_${automationOutcome.actionType ?? "unknown"}`,
      value: `${automationOutcome.status} at ${new Date().toISOString()}`,
      agentKey: "ceo",
    });
  }
  await writeMemory(db, projectId, job.id, memoryRows);
}
