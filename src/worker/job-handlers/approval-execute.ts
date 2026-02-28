import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { writeMemory } from "../memory";
import { executeApprovedAction } from "@/lib/action-execution";

export async function handleApprovalExecute(
  db: SupabaseClient,
  job: { id: string; project_id: string; payload: Record<string, unknown> }
) {
  const payload = job.payload ?? {};
  const approvalId = payload.approvalId as string;
  const projectId = (payload.projectId as string) ?? job.project_id;

  const existing = await db
    .from("action_executions")
    .select("id,status")
    .eq("approval_id", approvalId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.data?.status === "completed") {
    await emitJobEvent(db, {
      projectId,
      jobId: job.id,
      type: "log",
      message: "Already executed; skipping",
    });
    await db
      .from("approval_queue")
      .update({ execution_status: "completed" })
      .eq("id", approvalId);
    return;
  }

  await db
    .from("approval_queue")
    .update({ execution_status: "running" })
    .eq("id", approvalId);

  const approval = await db
    .from("approval_queue")
    .select("id,project_id,action_type,payload")
    .eq("id", approvalId)
    .single();
  if (approval.error || !approval.data) throw new Error("Approval not found");

  const project = await db
    .from("projects")
    .select(
      "id,name,domain,repo_url,owner_clerk_id,runtime_mode,phase,permissions"
    )
    .eq("id", approval.data.project_id)
    .single();
  if (project.error || !project.data) throw new Error("Project not found");

  const owner = await db
    .from("users")
    .select("email")
    .eq("clerk_id", project.data.owner_clerk_id)
    .maybeSingle();

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "log",
    message: `Executing ${approval.data.action_type}`,
  });

  const appBaseUrl =
    process.env.APP_BASE_URL ?? "https://greenlightstudio.vercel.app";

  await executeApprovedAction({
    approval: {
      id: approval.data.id,
      project_id: approval.data.project_id,
      action_type: approval.data.action_type,
      payload: (approval.data.payload as Record<string, unknown>) ?? null,
    },
    project: {
      id: project.data.id,
      name: project.data.name,
      domain: project.data.domain,
      repo_url: project.data.repo_url,
      owner_clerk_id: project.data.owner_clerk_id,
      runtime_mode: project.data.runtime_mode,
      phase: project.data.phase,
      permissions: (project.data.permissions as Record<string, unknown>) ?? null,
    },
    ownerEmail: (owner.data?.email as string | null) ?? null,
    appBaseUrl,
  });

  await db
    .from("approval_queue")
    .update({ execution_status: "completed" })
    .eq("id", approvalId);

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "artifact",
    message: `${approval.data.action_type} executed successfully`,
  });

  await writeMemory(db, projectId, job.id, [
    {
      category: "learning",
      key: `action_${approval.data.action_type}`,
      value: `Action ${approval.data.action_type} completed at ${new Date().toISOString()}`,
      agentKey: "engineering",
    },
  ]);
}
