import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";

export async function enqueueJob(input: {
  projectId: string;
  jobType: string;
  agentKey: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  priority?: number;
  runAfter?: string;
  maxAttempts?: number;
}) {
  const db = createServiceSupabase();
  const row = {
    project_id: input.projectId,
    job_type: input.jobType,
    agent_key: input.agentKey,
    payload: input.payload,
    idempotency_key: input.idempotencyKey,
    priority: input.priority ?? 0,
    run_after: input.runAfter ?? new Date().toISOString(),
    status: "queued",
    max_attempts: typeof input.maxAttempts === "number" ? Math.max(1, Math.min(8, Math.floor(input.maxAttempts))) : undefined,
  };

  const insert = await withRetry(() =>
    db.from("agent_jobs").insert(row).select("id").maybeSingle()
  );

  if (insert.data?.id) return insert.data.id as string;

  if (insert.error?.code === "23505") {
    const existing = await withRetry(() =>
      db
        .from("agent_jobs")
        .select("id")
        .eq("project_id", input.projectId)
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle()
    );
    if (existing.data?.id) return existing.data.id as string;
  }

  throw new Error(insert.error?.message ?? "Failed to enqueue job");
}
