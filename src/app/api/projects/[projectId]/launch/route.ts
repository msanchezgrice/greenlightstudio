import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase";
import { generatePhase0Packet } from "@/lib/agent";
import { onboardingSchema } from "@/types/domain";
import { save_packet, log_task } from "@/lib/supabase-mcp";
import { withRetry } from "@/lib/retry";

export const runtime = "nodejs";
export const maxDuration = 300;

async function logPhaseTask(projectId: string, agent: string, description: string, status: "running" | "completed" | "failed", detail: string) {
  await withRetry(() => log_task(projectId, agent, description, status, detail));
}

async function runPhase0(projectId: string, userId: string) {
  const db = createServiceSupabase();
  let initRunning = false;
  let researchRunning = false;
  let synthesisRunning = false;

  try {
    await logPhaseTask(projectId, "ceo_agent", "phase0_init", "running", "Initializing packet generation");
    initRunning = true;

    const { data: project, error: fetchError } = await withRetry(() =>
      db.from("projects").select("*").eq("id", projectId).eq("owner_clerk_id", userId).single(),
    );

    if (fetchError || !project) {
      throw new Error("Project not found");
    }

    const input = onboardingSchema.parse(project);
    await logPhaseTask(projectId, "ceo_agent", "phase0_init", "completed", "Project input validated");
    initRunning = false;

    await logPhaseTask(projectId, "research_agent", "phase0_research", "running", "Researching competitors and market");
    researchRunning = true;
    const packet = await generatePhase0Packet(input);
    const confidence = packet.reasoning_synopsis.confidence;
    await logPhaseTask(projectId, "research_agent", "phase0_research", "completed", `Research complete (${confidence}/100 confidence)`);
    researchRunning = false;

    await logPhaseTask(projectId, "ceo_agent", "phase0_synthesis", "running", "Synthesizing packet output");
    synthesisRunning = true;

    const packetId = await withRetry(() => save_packet(projectId, 0, packet));
    const risk = confidence < 40 ? "high" : confidence < 70 ? "medium" : "low";

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

    if (!existingApproval) {
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
    throw error;
  }

  await withRetry(() => log_task(projectId, "ceo_agent", "phase0_complete", "completed", "Phase 0 packet generated"));
}

export async function POST(_: Request, context: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await context.params;

  try {
    await runPhase0(projectId, userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    try {
      await withRetry(() =>
        log_task(projectId, "ceo_agent", "phase0_failed", "failed", error instanceof Error ? error.message : "Unknown launch error"),
      );
    } catch (loggingError) {
      console.error("Failed to persist phase0_failed task log", loggingError);
    }
    const errorMessage = error instanceof Error ? error.message : "Failed generating Phase 0 packet";
    const statusCode = errorMessage === "Project not found" ? 404 : 500;
    return NextResponse.json(
      { error: errorMessage },
      { status: statusCode },
    );
  }
}
