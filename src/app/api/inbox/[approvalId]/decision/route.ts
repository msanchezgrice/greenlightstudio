import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { update_phase, log_task, upsertUser } from "@/lib/supabase-mcp";
import { withRetry } from "@/lib/retry";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { JOB_TYPES, AGENT_KEYS, PRIORITY } from "@/lib/jobs/constants";

export const runtime = "nodejs";
export const maxDuration = 800;

const decisionSchema = z.object({
  decision: z.enum(["approved", "denied", "revised"]),
  version: z.number().int().positive(),
  guidance: z.string().trim().max(2000).optional(),
});

const phaseAdvanceActions = new Set([
  "phase0_packet_review",
  "phase1_validate_review",
  "phase2_distribute_review",
  "phase3_golive_review",
]);

const executableActions = new Set([
  "deploy_landing_page",
  "send_welcome_email_sequence",
  "send_phase2_lifecycle_email",
  "activate_meta_ads_campaign",
  "trigger_phase3_repo_workflow",
  "trigger_phase3_deploy",
]);

export async function POST(req: Request, context: { params: Promise<{ approvalId: string }> }) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsedBody = decisionSchema.safeParse(await req.json());
    if (!parsedBody.success) {
      return NextResponse.json({ error: parsedBody.error.issues[0]?.message ?? "Invalid decision payload." }, { status: 400 });
    }
    const body = parsedBody.data;
    const { approvalId } = await context.params;
    const db = createServiceSupabase();

    const { data: userRow } = await withRetry(() => db.from("users").select("id").eq("clerk_id", userId).maybeSingle());
    const resolvedBy = userRow?.id ?? (await withRetry(() => upsertUser(userId, null)));

    const { data: row, error: rowError } = await db
      .from("approval_queue")
      .select("id, project_id, phase, action_type, payload, version")
      .eq("id", approvalId)
      .single();
    if (rowError || !row) return NextResponse.json({ error: "Approval not found" }, { status: 404 });

    const { data: project } = await db
      .from("projects")
      .select("id,name,domain,repo_url,runtime_mode,owner_clerk_id,phase,permissions")
      .eq("id", row.project_id)
      .single();
    if (!project || project.owner_clerk_id !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (row.version !== body.version) return NextResponse.json({ error: "Conflict", expectedVersion: row.version }, { status: 409 });

    const isPhaseRevisionRequest = body.decision === "revised" && phaseAdvanceActions.has(row.action_type);
    const revisionGuidance = body.guidance?.trim() || null;
    const phase0RelaunchRequired = isPhaseRevisionRequest && row.phase === 0 && Boolean(revisionGuidance);
    let executionJobId: string | null = null;

    if (isPhaseRevisionRequest && !revisionGuidance) {
      return NextResponse.json({ error: "Revision guidance is required when requesting packet revisions." }, { status: 400 });
    }

    if (body.decision === "approved") {
      if (executableActions.has(row.action_type)) {
        executionJobId = await enqueueJob({
          projectId: row.project_id,
          jobType: JOB_TYPES.APPROVAL_EXEC,
          agentKey: AGENT_KEYS.ENGINEERING,
          payload: {
            approvalId: row.id,
            projectId: row.project_id,
            actionType: row.action_type,
          },
          idempotencyKey: `approval:${row.id}`,
          priority: PRIORITY.USER_BLOCKING,
        });
      }
    }

    const approvalUpdate: Record<string, unknown> = {
      status: body.decision,
      decided_by: userId,
      decided_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
      resolved_by: resolvedBy,
      version: row.version + 1,
    };
    if (body.decision === "approved" && executableActions.has(row.action_type) && executionJobId) {
      approvalUpdate.execution_status = "queued";
      approvalUpdate.execution_job_id = executionJobId;
    }

    const { error } = await db
      .from("approval_queue")
      .update(approvalUpdate)
      .eq("id", approvalId)
      .eq("version", body.version);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    if (body.decision === "approved") {
      if (phaseAdvanceActions.has(row.action_type)) {
        const nextPhase = Math.max(project.phase, row.phase) + 1;
        await enqueueJob({
          projectId: row.project_id,
          jobType: JOB_TYPES.PHASE_GEN,
          agentKey: AGENT_KEYS.CEO,
          payload: {
            projectId: row.project_id,
            phase: nextPhase,
            forceRegenerate: false,
            revisionGuidance: null,
          },
          idempotencyKey: `phasegen:${row.project_id}:${nextPhase}`,
          priority: PRIORITY.USER_BLOCKING,
        });
        await withRetry(() => update_phase(row.project_id, nextPhase));
      }
    }

    if (isPhaseRevisionRequest && revisionGuidance) {
      await withRetry(() =>
        log_task(
          row.project_id,
          "ceo_agent",
          "phase_revision_requested",
          "completed",
          `Revision guidance submitted for phase ${row.phase}: ${revisionGuidance.slice(0, 280)}`,
        ),
      );

      if (row.phase !== 0) {
        await enqueueJob({
          projectId: row.project_id,
          jobType: JOB_TYPES.PHASE_GEN,
          agentKey: AGENT_KEYS.CEO,
          payload: {
            projectId: row.project_id,
            phase: row.phase,
            forceRegenerate: true,
            revisionGuidance,
          },
          idempotencyKey: `phasegen:${row.project_id}:${row.phase}:revised`,
          priority: PRIORITY.USER_BLOCKING,
        });
      }
    }

    await withRetry(() => log_task(row.project_id, "ceo_agent", "approval_decision", "completed", `Decision: ${body.decision}`));

    return NextResponse.json({
      ok: true,
      version: row.version + 1,
      phase0RelaunchRequired,
      projectId: row.project_id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid decision payload." }, { status: 400 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed processing approval decision." },
      { status: 500 },
    );
  }
}
