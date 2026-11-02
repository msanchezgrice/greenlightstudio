import type { SupabaseClient } from "@supabase/supabase-js";

export type StaleJobSnapshot = {
  id: string;
  attempts: number;
  max_attempts: number;
  locked_at: string;
  locked_by: string | null;
};

/** Reclaim only if the job is still the exact stale attempt observed by the reader. */
export async function reclaimSnapshots(
  db: SupabaseClient, rows: StaleJobSnapshot[], cutoff: string, now: Date = new Date(),
): Promise<number> {
  let reclaimed = 0;
  for (const row of rows) {
    // Age never proves the old worker or external side effect has stopped.
    const payload = {
      status: "failed", locked_at: null, locked_by: null,
      last_error: "Worker lease expired; outcome uncertain. Reconcile before retry.", completed_at: now.toISOString(),
    };
    let update = db.from("agent_jobs").update(payload)
      .eq("id", row.id).eq("status", "running").eq("attempts", row.attempts).eq("max_attempts", row.max_attempts)
      .eq("locked_at", row.locked_at).lt("locked_at", cutoff);
    update = row.locked_by === null ? update.is("locked_by", null) : update.eq("locked_by", row.locked_by);
    const result = await update.select("id");
    if (result.error) throw new Error("Fallback stale job update failed");
    reclaimed += result.data?.length ?? 0;
  }
  return reclaimed;
}
