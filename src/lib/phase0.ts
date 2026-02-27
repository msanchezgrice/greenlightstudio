import { createServiceSupabase } from "@/lib/supabase";
import { generatePhase0Packet } from "@/lib/agent";
import { onboardingSchema, packetSchema, projectAssetSchema, type Packet, type ProjectAsset } from "@/types/domain";
import { save_packet, log_task } from "@/lib/supabase-mcp";
import { withRetry } from "@/lib/retry";
import { sendPhase0ReadyDrip } from "@/lib/drip-emails";

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

const PHASE0_TIMEOUT_MS = 800_000; // 800s — matches Vercel maxDuration

export async function runPhase0(opts: RunPhase0Options) {
  return Promise.race([
    runPhase0Inner(opts),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Phase 0 generation timed out (exceeded 800s)")), PHASE0_TIMEOUT_MS),
    ),
  ]);
}

async function runPhase0Inner({ projectId, userId, revisionGuidance, forceNewApproval }: RunPhase0Options) {
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

    // Fetch uploaded project assets so the agent can analyze them
    let projectAssets: ProjectAsset[] = [];
    try {
      const { data: assetRows } = await withRetry(() =>
        db
          .from("project_assets")
          .select("id,filename,mime_type,size_bytes,status,storage_path")
          .eq("project_id", projectId)
          .in("status", ["uploaded", "completed"])
          .order("created_at", { ascending: true }),
      );
      if (assetRows && assetRows.length > 0) {
        projectAssets = assetRows
          .map((row) => projectAssetSchema.safeParse(row))
          .filter((result): result is { success: true; data: ProjectAsset } => result.success)
          .map((result) => result.data);
      }
    } catch (assetError) {
      // Non-fatal: log but continue without assets
      console.warn("Failed to fetch project assets for phase0, continuing without them:", assetError);
    }

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
    const packet = await generatePhase0Packet(input, trimmedGuidance, priorPacket, projectAssets);
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
          title: "Startup Machine Phase 0 Packet for Review",
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

  // Fire-and-forget drip notification for first Phase 0 report
  try {
    const dripDb = createServiceSupabase();
    const [{ data: ownerRow }, { data: projectRow }, { data: packetRow }] = await Promise.all([
      dripDb.from("users").select("id, email").eq("clerk_id", userId).maybeSingle(),
      dripDb.from("projects").select("name").eq("id", projectId).single(),
      dripDb
        .from("phase_packets")
        .select("confidence_score, ceo_recommendation")
        .eq("project_id", projectId)
        .eq("phase", 0)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (ownerRow?.email && projectRow?.name && packetRow) {
      await sendPhase0ReadyDrip({
        userId: ownerRow.id as string,
        email: ownerRow.email as string,
        projectId,
        projectName: projectRow.name as string,
        confidence: (packetRow.confidence_score as number) ?? 50,
        recommendation: (packetRow.ceo_recommendation as string) ?? "revise",
      });
    }
  } catch {
    // Non-fatal: drip email failure should not break phase0
  }
}
