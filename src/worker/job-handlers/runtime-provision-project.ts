import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { recordProjectEvent } from "@/lib/project-events";

async function ensureRuntimeInstance(db: SupabaseClient, projectId: string) {
  const existing = await db
    .from("project_runtime_instances")
    .select("id,status,mode")
    .eq("project_id", projectId)
    .maybeSingle();

  if (existing.data) return existing.data;

  const { data, error } = await db
    .from("project_runtime_instances")
    .insert({
      project_id: projectId,
      status: "shared",
      mode: "shared",
      provider: "render",
      runtime_metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id,status,mode")
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed creating runtime instance");
  return data;
}

async function markProvisioning(db: SupabaseClient, runtimeId: string, projectId: string) {
  const { error } = await db
    .from("project_runtime_instances")
    .update({
      status: "provisioning",
      mode: "provisioning",
      updated_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", runtimeId)
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
}

export async function handleRuntimeProvisionProject(
  db: SupabaseClient,
  job: { id: string; project_id: string; payload: Record<string, unknown> },
) {
  const payload = job.payload ?? {};
  const projectId = (payload.projectId as string) ?? job.project_id;
  const provider = (payload.provider as string) ?? "render";
  const runtimeEndpoint = (payload.runtimeEndpoint as string) ?? `https://${projectId.slice(0, 8)}.dedicated.greenlight.local`;
  const forceFail = Boolean(payload.forceFail);

  const runtime = await ensureRuntimeInstance(db, projectId);

  const { data: provisioningRow, error: provisioningInsertError } = await db
    .from("project_provisioning_jobs")
    .insert({
      project_id: projectId,
      runtime_instance_id: runtime.id,
      status: "running",
      step: "init",
      attempts: 1,
      metadata: {
        job_id: job.id,
        provider,
      },
      created_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (provisioningInsertError) throw new Error(provisioningInsertError.message);
  const provisioningId = String(provisioningRow.id);

  try {
    await markProvisioning(db, runtime.id as string, projectId);

    await emitJobEvent(db, {
      projectId,
      jobId: job.id,
      type: "log",
      message: "Runtime provisioning started",
    });

    await recordProjectEvent(db, {
      projectId,
      eventType: "runtime.provisioning_started",
      message: "Dedicated runtime provisioning started",
      data: {
        provisioning_job_id: provisioningId,
        provider,
      },
      agentKey: "provisioner",
    });

    await db
      .from("project_provisioning_jobs")
      .update({ step: "provision_runtime" })
      .eq("id", provisioningId);

    await emitJobEvent(db, {
      projectId,
      jobId: job.id,
      type: "log",
      message: "Provisioning runtime target",
    });

    await db
      .from("project_provisioning_jobs")
      .update({ step: "provision_database" })
      .eq("id", provisioningId);

    await emitJobEvent(db, {
      projectId,
      jobId: job.id,
      type: "log",
      message: "Provisioning dedicated database",
    });

    await db
      .from("project_provisioning_jobs")
      .update({ step: "configure_secrets" })
      .eq("id", provisioningId);

    await emitJobEvent(db, {
      projectId,
      jobId: job.id,
      type: "log",
      message: "Configuring runtime secrets and integrations",
    });

    if (forceFail) {
      throw new Error("Forced provisioning failure for testing fallback path");
    }

    await db
      .from("project_runtime_instances")
      .update({
        status: "dedicated",
        mode: "dedicated",
        provider,
        runtime_endpoint: runtimeEndpoint,
        runtime_metadata: {
          migrated_from_shared: true,
          activated_at: new Date().toISOString(),
        },
        repo_ref: `${projectId}-dedicated-repo`,
        db_ref: `${projectId}-neon-db`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", runtime.id)
      .eq("project_id", projectId);

    await db
      .from("project_provisioning_jobs")
      .update({
        status: "completed",
        step: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", provisioningId);

    await emitJobEvent(db, {
      projectId,
      jobId: job.id,
      type: "artifact",
      message: "Dedicated runtime provisioned",
      data: {
        runtime_endpoint: runtimeEndpoint,
        provider,
      },
    });

    await recordProjectEvent(db, {
      projectId,
      eventType: "runtime.provisioning_completed",
      message: "Dedicated runtime provisioning completed",
      data: {
        provisioning_job_id: provisioningId,
        runtime_endpoint: runtimeEndpoint,
        provider,
      },
      agentKey: "provisioner",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Runtime provisioning failed";

    await db
      .from("project_runtime_instances")
      .update({
        status: "failed",
        mode: "shared",
        last_error: detail,
        updated_at: new Date().toISOString(),
      })
      .eq("id", runtime.id)
      .eq("project_id", projectId);

    await db
      .from("project_provisioning_jobs")
      .update({
        status: "failed",
        step: "failed",
        error: detail,
        completed_at: new Date().toISOString(),
      })
      .eq("id", provisioningId);

    await recordProjectEvent(db, {
      projectId,
      eventType: "runtime.provisioning_failed",
      message: "Dedicated provisioning failed; project remains on shared mode",
      data: {
        provisioning_job_id: provisioningId,
        error: detail,
      },
      agentKey: "provisioner",
    });

    throw new Error(detail);
  }
}
