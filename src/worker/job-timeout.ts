export class QuarantinedTimeout extends Error {
  constructor(public readonly quarantineFailed: boolean, public readonly workUnsettled = false) {
    super("Job timed out; outcome uncertain and requires reconciliation");
    this.name = "QuarantinedTimeout";
  }
}

/** Quarantine the timed-out attempt and bound the grace period before worker shutdown.
 * This does not cancel external or detached operations; the native stale reaper
 * must also quarantine rather than requeue before this worker can be deployed.
 */
export async function runWithTimeoutQuarantine(
  execute: () => Promise<void>, timeoutMs: number, quarantine: () => Promise<void>, graceMs = 20_000, quarantineTimeoutMs = 5_000,
): Promise<void> {
  const work = Promise.resolve().then(execute);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    await Promise.race([
      work,
      new Promise<never>((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error("timeout")); }, timeoutMs); }),
    ]);
  } catch (error) {
    if (!timedOut) throw error;
    let quarantineFailed = false;
    let quarantineTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(quarantine),
        new Promise<never>((_, reject) => { quarantineTimer = setTimeout(() => reject(new Error("quarantine timeout")), quarantineTimeoutMs); }),
      ]);
    } catch { quarantineFailed = true; }
    finally { if (quarantineTimer) clearTimeout(quarantineTimer); }
    // Safe automatic restart depends on the separately reviewed native reaper
    // quarantining stale jobs and on all older requeueing workers being stopped.
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      work.then(() => true, () => true),
      new Promise<false>(resolve => { graceTimer = setTimeout(() => resolve(false), graceMs); }),
    ]);
    if (graceTimer) clearTimeout(graceTimer);
    throw new QuarantinedTimeout(quarantineFailed, !settled);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function uncertainFailurePayload(now = new Date()) {
  return {
    status: "failed", last_error: "Job failed; outcome may be uncertain. Reconcile before retry.",
    locked_at: null, locked_by: null, completed_at: now.toISOString(),
  };
}

export type ClaimedJob = { id: string; attempts: number; locked_at: string | null; locked_by: string | null };

/** Update only the exact running attempt this worker claimed. Not a renewable lease token. */
export async function transitionOwnedJob(
  db: import("@supabase/supabase-js").SupabaseClient,
  job: ClaimedJob, workerId: string, payload: Record<string, unknown>,
): Promise<boolean> {
  if (!job.locked_at || job.locked_by !== workerId || !Number.isInteger(job.attempts)) return false;
  const result = await db.from("agent_jobs").update(payload)
    .eq("id", job.id).eq("status", "running").eq("locked_by", workerId)
    .eq("attempts", job.attempts).eq("locked_at", job.locked_at).select("id");
  if (result.error) throw new Error("Job transition failed");
  return result.data?.length === 1;
}

export async function quarantineAttempt(
  db: import("@supabase/supabase-js").SupabaseClient, job: ClaimedJob, workerId: string,
): Promise<void> {
  const updated = await transitionOwnedJob(db, job, workerId, {
    status: "failed", last_error: "Timed out; outcome uncertain. Reconcile before retry.",
    locked_at: null, locked_by: null, completed_at: new Date().toISOString(),
  });
  if (!updated) throw new Error("Job quarantine failed");
}
