import { createAdminSupabase } from "./supabase-admin";
import { getWorkerConfig } from "./worker-config";
import { getHandler, type JobRow } from "./job-handlers";
import { emitJobEvent } from "./job-events";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

let shuttingDown = false;

class FatalWorkerError extends Error {}
class JobTimeoutError extends Error {
  constructor(jobId: string, timeoutMs: number) {
    super(`Job ${jobId} timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = "JobTimeoutError";
  }
}

const HEAVY_JOB_TYPES = new Set([
  "phase0.generate_packet",
  "phase.generate_packet",
  "code.generate_mvp",
  "research.generate_report",
  "browser.check_page",
]);

const REALTIME_JOB_TYPES = new Set(["chat.reply"]);

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

function formatMemorySnapshot() {
  const usage = process.memoryUsage();
  const rssMb = usage.rss / 1024 / 1024;
  const heapUsedMb = usage.heapUsed / 1024 / 1024;
  const heapTotalMb = usage.heapTotal / 1024 / 1024;
  const externalMb = usage.external / 1024 / 1024;
  return {
    rssMb,
    heapUsedMb,
    heapTotalMb,
    externalMb,
  };
}

async function reclaimStaleJobsFallback(
  db: ReturnType<typeof createAdminSupabase>,
  cfg: ReturnType<typeof getWorkerConfig>,
) {
  // Treat jobs as stale only after they exceed configured timeout + a buffer.
  const staleThresholdMs = Math.max(cfg.jobTimeoutMs + 120_000, 10 * 60_000);
  const cutoff = new Date(Date.now() - staleThresholdMs).toISOString();

  const stale = await db
    .from("agent_jobs")
    .select("id,attempts,max_attempts")
    .eq("status", "running")
    .lt("locked_at", cutoff)
    .limit(Math.max(100, cfg.claimBatch * 10));
  if (stale.error) {
    throw new Error(`fallback stale query failed: ${stale.error.message}`);
  }

  const rows = (stale.data ?? []) as Array<{ id: string; attempts: number; max_attempts: number }>;
  if (!rows.length) return 0;

  const retriableIds = rows.filter((row) => row.attempts < row.max_attempts).map((row) => row.id);
  const exhaustedIds = rows.filter((row) => row.attempts >= row.max_attempts).map((row) => row.id);
  let reclaimed = 0;

  if (retriableIds.length) {
    const runAfter = new Date(Date.now() + 15_000).toISOString();
    const retriableUpdate = await db
      .from("agent_jobs")
      .update({
        status: "queued",
        run_after: runAfter,
        locked_at: null,
        locked_by: null,
        last_error: "reclaimed: stale running job recovered by worker fallback",
        completed_at: null,
      })
      .in("id", retriableIds);
    if (retriableUpdate.error) {
      throw new Error(`fallback reclaim retriable failed: ${retriableUpdate.error.message}`);
    }
    reclaimed += retriableIds.length;
  }

  if (exhaustedIds.length) {
    const exhaustedUpdate = await db
      .from("agent_jobs")
      .update({
        status: "failed",
        locked_at: null,
        locked_by: null,
        last_error: "reclaimed: stale running job exceeded max attempts (worker fallback)",
        completed_at: new Date().toISOString(),
      })
      .in("id", exhaustedIds);
    if (exhaustedUpdate.error) {
      throw new Error(`fallback reclaim exhausted failed: ${exhaustedUpdate.error.message}`);
    }
    reclaimed += exhaustedIds.length;
  }

  return reclaimed;
}

async function runOnce(cfg: ReturnType<typeof getWorkerConfig>) {
  const db = createAdminSupabase();

  const claim = await db.rpc("claim_agent_jobs", {
    p_worker_id: cfg.workerId,
    p_limit: cfg.claimBatch,
  });
  if (claim.error) {
    throw new Error(`claim_agent_jobs failed: ${claim.error.message}`);
  }
  const jobs = (claim.data ?? []) as JobRow[];
  if (!jobs.length) return { ran: 0 };

  const pendingJobs = [...jobs].sort((left, right) => {
    const leftRealtime = REALTIME_JOB_TYPES.has(left.job_type) ? 1 : 0;
    const rightRealtime = REALTIME_JOB_TYPES.has(right.job_type) ? 1 : 0;
    return rightRealtime - leftRealtime;
  });
  let heavyInFlight = 0;

  const takeNextJob = async (): Promise<{ job: JobRow; isHeavy: boolean } | null> => {
    while (!shuttingDown) {
      if (!pendingJobs.length) return null;
      const selectableIndex = pendingJobs.findIndex((candidate) => {
        const isHeavy = HEAVY_JOB_TYPES.has(candidate.job_type);
        if (!isHeavy) return true;
        return heavyInFlight < cfg.heavyConcurrency;
      });
      if (selectableIndex < 0) {
        await sleep(75);
        continue;
      }
      const [job] = pendingJobs.splice(selectableIndex, 1);
      const isHeavy = HEAVY_JOB_TYPES.has(job.job_type);
      if (isHeavy) heavyInFlight += 1;
      return { job, isHeavy };
    }
    return null;
  };

  const workers = Array.from({ length: cfg.concurrency }).map(async () => {
    while (!shuttingDown) {
      const next = await takeNextJob();
      if (!next) break;
      const { job, isHeavy } = next;

      const handler = getHandler(job.job_type);

      try {
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

        await emitJobEvent(db, {
          projectId: job.project_id,
          jobId: job.id,
          type: "status",
          message: "running",
        });

        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        try {
          await Promise.race([
            handler(db, job),
            new Promise<never>((_, reject) => {
              timeoutHandle = setTimeout(() => {
                reject(new JobTimeoutError(job.id, cfg.jobTimeoutMs));
              }, cfg.jobTimeoutMs);
            }),
          ]);
        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle);
        }

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

        if (err instanceof JobTimeoutError) {
          throw new FatalWorkerError(
            `[worker] timed out job ${job.id}; forcing recycle to clear lingering resources`,
          );
        }
      } finally {
        if (isHeavy) {
          heavyInFlight = Math.max(0, heavyInFlight - 1);
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
    `[worker] starting id=${cfg.workerId} concurrency=${cfg.concurrency} heavyConcurrency=${cfg.heavyConcurrency} pollMs=${cfg.pollMs} timeoutMs=${cfg.jobTimeoutMs} maxJobs=${cfg.maxJobsPerProcess} maxRssMb=${cfg.maxRssMb}`
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
  let processedJobs = 0;
  let lastMemoryLogAt = 0;

  while (!shuttingDown) {
    const now = Date.now();

    const memory = formatMemorySnapshot();
    if (now - lastMemoryLogAt >= cfg.memoryLogIntervalMs) {
      console.log(
        `[worker] health rss=${memory.rssMb.toFixed(1)}MB heap=${memory.heapUsedMb.toFixed(1)}/${memory.heapTotalMb.toFixed(1)}MB ext=${memory.externalMb.toFixed(1)}MB`,
      );
      lastMemoryLogAt = now;
    }
    if (cfg.maxRssMb > 0 && memory.rssMb >= cfg.maxRssMb) {
      throw new FatalWorkerError(
        `[worker] rss ${memory.rssMb.toFixed(1)}MB exceeded limit ${cfg.maxRssMb}MB`,
      );
    }

    if (now - lastReclaim > cfg.reclaimIntervalMs) {
      try {
        const db = createAdminSupabase();
        const rpcResult = await db.rpc("reclaim_stale_jobs");
        if (rpcResult.error) {
          throw new Error(`reclaim_stale_jobs failed: ${rpcResult.error.message}`);
        }
        const reclaimedViaRpc = Number(rpcResult.data ?? 0);
        let reclaimedViaFallback = 0;
        if (reclaimedViaRpc === 0) {
          reclaimedViaFallback = await reclaimStaleJobsFallback(db, cfg);
        }
        const reclaimedTotal = reclaimedViaRpc + reclaimedViaFallback;
        if (reclaimedTotal > 0) {
          console.log(
            `[worker] reclaimed ${reclaimedTotal} stale jobs${reclaimedViaFallback > 0 ? " (fallback reaper)" : ""}`,
          );
        }
      } catch (e) {
        console.error("[worker] reclaim error:", e);
      }
      lastReclaim = now;
    }

    try {
      const { ran } = await runOnce(cfg);
      consecutivePollErrors = 0;
      if (ran > 0) {
        processedJobs += ran;
        console.log(`[worker] processed ${ran} jobs`);
      }
      if (cfg.maxJobsPerProcess > 0 && processedJobs >= cfg.maxJobsPerProcess) {
        throw new FatalWorkerError(
          `[worker] recycling process after ${processedJobs} jobs`,
        );
      }
    } catch (e) {
      if (e instanceof FatalWorkerError) {
        throw e;
      }
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
