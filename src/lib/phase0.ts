import { createServiceSupabase } from "@/lib/supabase";
import { generatePhase0Packet } from "@/lib/agent";
import { onboardingSchema, packetSchema, type Packet } from "@/types/domain";
import { save_packet, log_task } from "@/lib/supabase-mcp";
import { withRetry } from "@/lib/retry";

type RunPhase0Options = {
  projectId: string;
  userId: string;
  revisionGuidance?: string | null;
  forceNewApproval?: boolean;
};

type PhaseTaskStatus = "running" | "completed" | "failed";

function truncateDetail(value: string, maxLength = 320) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

async function logPhaseTask(
  projectId: string,
  agent: string,
  description: string,
  status: PhaseTaskStatus,
  detail: string,
) {
  await withRetry(() => log_task(projectId, agent, description, status, detail));
}

export async function logPhase0Failure(projectId: string, error: unknown) {
  try {
    await withRetry(() =>
      log_task(projectId, "ceo_agent", "phase0_failed", "failed", error instanceof Error ? error.message : "Unknown launch error"),
    );
  } catch (loggingError) {
    console.error("Failed to persist phase0_failed task log", loggingError);
  }
}

export async function runPhase0({ projectId, userId, revisionGuidance, forceNewApproval }: RunPhase0Options) {
  const db = createServiceSupabase();
  let initRunning = false;
  let researchRunning = false;
  let synthesisRunning = false;
  const trimmedGuidance = revisionGuidance?.trim() || null;
  const shouldForceNewApproval = Boolean(forceNewApproval);
  let priorPacket: Packet | null = null;

  try {
    if (trimmedGuidance) {
      await logPhaseTask(
        projectId,
        "ceo_agent",
        "phase0_revision",
        "running",
        `Revision guidance received: ${truncateDetail(trimmedGuidance)}`,
      );
    }

    await logPhaseTask(projectId, "ceo_agent", "phase0_init", "running", "Initializing packet generation");
    initRunning = true;

    const { data: project, error: fetchError } = await withRetry(() =>
      db.from("projects").select("*").eq("id", projectId).eq("owner_clerk_id", userId).single(),
    );

    if (fetchError || !project) {
      throw new Error("Project not found");
    }

    const input = onboardingSchema.parse(project);

    if (trimmedGuidance) {
      const { data: priorPacketRow, error: priorPacketError } = await withRetry(() =>
        db
          .from("phase_packets")
          .select("packet")
          .eq("project_id", projectId)
          .eq("phase", 0)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      );
      if (priorPacketError) {
        throw new Error(priorPacketError.message);
      }
      const parsedPriorPacket = packetSchema.safeParse(priorPacketRow?.packet ?? null);
      priorPacket = parsedPriorPacket.success ? parsedPriorPacket.data : null;
    }

    await logPhaseTask(projectId, "ceo_agent", "phase0_init", "completed", "Project input validated");
    initRunning = false;

    await logPhaseTask(projectId, "research_agent", "phase0_research", "running", "Researching competitors and market");
    researchRunning = true;
    const packet = await generatePhase0Packet(input, trimmedGuidance, priorPacket);
    const confidence = packet.reasoning_synopsis.confidence;
    await logPhaseTask(projectId, "research_agent", "phase0_research", "completed", `Research complete (${confidence}/100 confidence)`);
    researchRunning = false;

    await logPhaseTask(projectId, "ceo_agent", "phase0_synthesis", "running", "Synthesizing packet output");
    synthesisRunning = true;

    const packetId = await withRetry(() => save_packet(projectId, 0, packet));
    const risk = confidence < 40 ? "high" : confidence < 70 ? "medium" : "low";

    if (shouldForceNewApproval) {
      const now = new Date().toISOString();
      const { error: supersedeError } = await withRetry(() =>
        db
          .from("approval_queue")
          .update({
            status: "revised",
            decided_at: now,
            resolved_at: now,
          })
          .eq("project_id", projectId)
          .eq("phase", 0)
          .eq("action_type", "phase0_packet_review")
          .eq("status", "pending"),
      );
      if (supersedeError) throw new Error(supersedeError.message);
    }

    let existingApprovalId: string | null = null;
    if (!shouldForceNewApproval) {
      const { data: existingApproval, error: existingApprovalError } = await withRetry(() =>
        db
          .from("approval_queue")
          .select("id")
          .eq("project_id", projectId)
          .eq("phase", 0)
          .eq("action_type", "phase0_packet_review")
          .eq("status", "pending")
          .maybeSingle(),
      );

      if (existingApprovalError) {
        throw new Error(existingApprovalError.message);
      }

      existingApprovalId = (existingApproval?.id as string | undefined) ?? null;
    }

    if (!existingApprovalId || shouldForceNewApproval) {
      const { error: approvalError } = await withRetry(() =>
        db.from("approval_queue").insert({
          project_id: projectId,
          packet_id: packetId,
          phase: 0,
          type: "phase_advance",
          title: "Greenlight Phase 0 Packet for Review",
          description: `CEO recommendation: ${packet.recommendation.toUpperCase()} (${confidence}/100 confidence).`,
          risk,
          risk_level: risk,
          action_type: "phase0_packet_review",
          agent_source: "ceo_agent",
          payload: packet,
        }),
      );

      if (approvalError) {
        throw new Error(approvalError.message);
      }
    }

    await logPhaseTask(projectId, "ceo_agent", "phase0_synthesis", "completed", "Packet and approval queue saved");
    synthesisRunning = false;

    if (trimmedGuidance) {
      await logPhaseTask(projectId, "ceo_agent", "phase0_revision", "completed", "Revision run completed");
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown launch error";
    if (synthesisRunning) {
      await logPhaseTask(projectId, "ceo_agent", "phase0_synthesis", "failed", detail);
    }
    if (researchRunning) {
      await logPhaseTask(projectId, "research_agent", "phase0_research", "failed", detail);
    }
    if (initRunning) {
      await logPhaseTask(projectId, "ceo_agent", "phase0_init", "failed", detail);
    }
    if (trimmedGuidance) {
      await logPhaseTask(projectId, "ceo_agent", "phase0_revision", "failed", detail);
    }
    throw error;
  }

  await withRetry(() => log_task(projectId, "ceo_agent", "phase0_complete", "completed", "Phase 0 packet generated"));
}
