import { createAdminSupabase } from "./supabase-admin";
import { getWorkerConfig } from "./worker-config";
import { getHandler, type JobRow } from "./job-handlers";
import { emitJobEvent } from "./job-events";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

let shuttingDown = false;

async function finalizeJob(
  db: ReturnType<typeof createAdminSupabase>,
  jobId: string,
  status: "completed" | "failed" | "canceled",
  error: string | null,
) {
  const payload: Record<string, unknown> = {
    status,
    last_error: error,
    locked_at: null,
    locked_by: null,
    completed_at: new Date().toISOString(),
  };
  const result = await db.from("agent_jobs").update(payload).eq("id", jobId);
  if (result.error) {
    throw new Error(`finalize job failed: ${result.error.message}`);
  }
}

async function runOnce() {
  const db = createAdminSupabase();
  const cfg = getWorkerConfig();

  const claim = await db.rpc("claim_agent_jobs", {
    p_worker_id: cfg.workerId,
    p_limit: cfg.claimBatch,
  });
  if (claim.error) {
    throw new Error(`claim_agent_jobs failed: ${claim.error.message}`);
  }
  const jobs = (claim.data ?? []) as JobRow[];
  if (!jobs.length) return { ran: 0 };

  let idx = 0;
  const workers = Array.from({ length: cfg.concurrency }).map(async () => {
    while (idx < jobs.length && !shuttingDown) {
      const job = jobs[idx++];
      if (!job) break;

      const handler = getHandler(job.job_type);

      if (!handler) {
        await emitJobEvent(db, {
          projectId: job.project_id,
          jobId: job.id,
          type: "status",
          message: `failed: unknown job_type ${job.job_type}`,
        });
        await finalizeJob(db, job.id, "failed", `Unknown job_type ${job.job_type}`);
        continue;
      }

      try {
        await emitJobEvent(db, {
          projectId: job.project_id,
          jobId: job.id,
          type: "status",
          message: "running",
        });
        await handler(db, job);
        await emitJobEvent(db, {
          projectId: job.project_id,
          jobId: job.id,
          type: "status",
          message: "completed",
        });
        await finalizeJob(db, job.id, "completed", null);
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "Job failed with unknown error";
        await emitJobEvent(db, {
          projectId: job.project_id,
          jobId: job.id,
          type: "status",
          message: "failed",
          data: { error: msg },
        });

        const retriable = job.attempts < job.max_attempts;
        if (retriable) {
          const backoffMs = 30_000 * Math.max(1, job.attempts);
          const runAfter = new Date(Date.now() + backoffMs).toISOString();
          await db
            .from("agent_jobs")
            .update({
              status: "queued",
              run_after: runAfter,
              locked_at: null,
              locked_by: null,
              last_error: msg,
              completed_at: null,
            })
            .eq("id", job.id);
        } else {
          await finalizeJob(db, job.id, "failed", msg);
        }
      }
    }
  });

  await Promise.all(workers);
  return { ran: jobs.length };
}

async function main() {
  // Fail fast on configuration issues so process managers restart visibly.
  createAdminSupabase();

  const cfg = getWorkerConfig();
  console.log(
    `[worker] starting id=${cfg.workerId} concurrency=${cfg.concurrency} pollMs=${cfg.pollMs}`
  );

  process.on("SIGTERM", () => {
    console.log("[worker] SIGTERM received, draining...");
    shuttingDown = true;
  });
  process.on("SIGINT", () => {
    console.log("[worker] SIGINT received, draining...");
    shuttingDown = true;
  });

  let lastReclaim = 0;
  let consecutivePollErrors = 0;

  while (!shuttingDown) {
    const now = Date.now();
    if (now - lastReclaim > cfg.reclaimIntervalMs) {
      try {
        const db = createAdminSupabase();
        const result = await db.rpc("reclaim_stale_jobs");
        if (result.error) {
          throw new Error(`reclaim_stale_jobs failed: ${result.error.message}`);
        }
        if (result.data && Number(result.data) > 0) {
          console.log(`[worker] reclaimed ${result.data} stale jobs`);
        }
      } catch (e) {
        console.error("[worker] reclaim error:", e);
      }
      lastReclaim = now;
    }

    try {
      const { ran } = await runOnce();
      consecutivePollErrors = 0;
      if (ran > 0) {
        console.log(`[worker] processed ${ran} jobs`);
      }
    } catch (e) {
      consecutivePollErrors += 1;
      console.error("[worker] poll error:", e);
      if (consecutivePollErrors >= 10) {
        throw new Error(
          `[worker] exiting after ${consecutivePollErrors} consecutive poll errors`
        );
      }
    }

    await sleep(cfg.pollMs);
  }

  console.log("[worker] shutdown complete");
}

main().catch((e) => {
  console.error("[worker] fatal:", e);
  process.exit(1);
});
