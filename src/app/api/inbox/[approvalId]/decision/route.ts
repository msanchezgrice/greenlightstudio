import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { update_phase, log_task, upsertUser } from "@/lib/supabase-mcp";
import { enqueueNextPhaseArtifacts } from "@/lib/phase-orchestrator";
import { withRetry } from "@/lib/retry";
import { executeApprovedAction } from "@/lib/action-execution";
import { runPhase0 } from "@/lib/phase0";

export const runtime = "nodejs";
export const maxDuration = 300;

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

    const { data: ownerUser } = await db.from("users").select("email").eq("clerk_id", userId).maybeSingle();
    const isPhaseRevisionRequest = body.decision === "revised" && phaseAdvanceActions.has(row.action_type);
    const revisionGuidance = body.guidance?.trim() || null;

    if (isPhaseRevisionRequest && !revisionGuidance) {
      return NextResponse.json({ error: "Revision guidance is required when requesting packet revisions." }, { status: 400 });
    }

    if (body.decision === "approved") {
      const executableActions = new Set([
        "deploy_landing_page",
        "send_welcome_email_sequence",
        "send_phase2_lifecycle_email",
        "activate_meta_ads_campaign",
        "trigger_phase3_repo_workflow",
        "trigger_phase3_deploy",
      ]);

      if (executableActions.has(row.action_type)) {
        try {
          await executeApprovedAction({
            approval: {
              id: row.id,
              project_id: row.project_id,
              action_type: row.action_type,
              payload: (row.payload as Record<string, unknown> | null) ?? null,
            },
            project: {
              id: project.id,
              name: project.name as string,
              domain: (project.domain as string | null) ?? null,
              repo_url: (project.repo_url as string | null) ?? null,
              owner_clerk_id: project.owner_clerk_id as string,
              runtime_mode: project.runtime_mode as "shared" | "attached",
              phase: project.phase as number,
              permissions: (project.permissions as {
                repo_write?: boolean;
                deploy?: boolean;
                ads_enabled?: boolean;
                ads_budget_cap?: number;
                email_send?: boolean;
              } | null) ?? null,
            },
            ownerEmail: (ownerUser?.email as string | null) ?? null,
            appBaseUrl: new URL(req.url).origin,
          });
        } catch (executionError) {
          return NextResponse.json(
            {
              error: executionError instanceof Error ? executionError.message : "Action execution failed",
            },
            { status: 400 },
          );
        }
      }
    }

    const { error } = await db
      .from("approval_queue")
      .update({
        status: body.decision,
        decided_by: userId,
        decided_at: new Date().toISOString(),
        resolved_at: new Date().toISOString(),
        resolved_by: resolvedBy,
        version: row.version + 1,
      })
      .eq("id", approvalId)
      .eq("version", body.version);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    if (body.decision === "approved") {
      if (phaseAdvanceActions.has(row.action_type)) {
        const nextPhase = Math.max(project.phase, row.phase) + 1;
        await withRetry(() => update_phase(row.project_id, nextPhase));

        try {
          await withRetry(() => enqueueNextPhaseArtifacts(row.project_id, nextPhase));
        } catch (phaseError) {
          await withRetry(() =>
            log_task(
              row.project_id,
              "ceo_agent",
              "phase_artifacts_failed",
              "failed",
              phaseError instanceof Error ? phaseError.message : "Failed to enqueue phase artifacts",
            ),
          );
        }
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

      try {
        if (row.phase === 0) {
          await runPhase0({
            projectId: row.project_id,
            userId,
            revisionGuidance,
            forceNewApproval: true,
          });
        } else {
          await enqueueNextPhaseArtifacts(row.project_id, row.phase as 1 | 2 | 3, {
            forceRegenerate: true,
            revisionGuidance,
          });
        }
      } catch (phaseError) {
        const message = phaseError instanceof Error ? phaseError.message : "Failed to re-run phase with guidance";
        await withRetry(() =>
          log_task(
            row.project_id,
            "ceo_agent",
            row.phase === 0 ? "phase0_revision_failed" : `phase${row.phase}_revision_failed`,
            "failed",
            message,
          ),
        );
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }

    await withRetry(() => log_task(row.project_id, "ceo_agent", "approval_decision", "completed", `Decision: ${body.decision}`));

    return NextResponse.json({ ok: true, version: row.version + 1 });
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
