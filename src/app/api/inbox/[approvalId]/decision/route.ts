import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { update_phase, log_task, upsertUser } from "@/lib/supabase-mcp";
import { enqueueNextPhaseArtifacts } from "@/lib/phase-orchestrator";
import { withRetry } from "@/lib/retry";

const decisionSchema = z.object({ decision: z.enum(["approved", "denied", "revised"]), version: z.number().int().positive() });

export async function POST(req: Request, context: { params: Promise<{ approvalId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = decisionSchema.parse(await req.json());
  const { approvalId } = await context.params;
  const db = createServiceSupabase();

  const { data: userRow } = await withRetry(() => db.from("users").select("id").eq("clerk_id", userId).maybeSingle());
  const resolvedBy = userRow?.id ?? (await withRetry(() => upsertUser(userId, null)));

  const { data: row, error: rowError } = await db
    .from("approval_queue")
    .select("id, project_id, phase, action_type, version")
    .eq("id", approvalId)
    .single();
  if (rowError || !row) return NextResponse.json({ error: "Approval not found" }, { status: 404 });

  const { data: project } = await db.from("projects").select("owner_clerk_id, phase").eq("id", row.project_id).single();
  if (!project || project.owner_clerk_id !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (row.version !== body.version) return NextResponse.json({ error: "Conflict", expectedVersion: row.version }, { status: 409 });

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
    const phaseAdvanceActions = new Set([
      "phase0_packet_review",
      "phase1_validate_review",
      "phase2_distribute_review",
      "phase3_golive_review",
    ]);

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

  await withRetry(() => log_task(row.project_id, "ceo_agent", "approval_decision", "completed", `Decision: ${body.decision}`));

  return NextResponse.json({ ok: true, version: row.version + 1 });
}
