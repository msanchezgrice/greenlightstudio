import { createAdminSupabase } from "./supabase-admin";
import { getWorkerConfig } from "./worker-config";
import { getHandler, type JobRow } from "./job-handlers";
import { emitJobEvent } from "./job-events";
import { quarantineAttempt, transitionOwnedJob, uncertainFailurePayload, runWithTimeoutQuarantine, QuarantinedTimeout } from "./job-timeout";
import { reclaimSnapshots, type StaleJobSnapshot } from "./reclaim-fallback";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

let shuttingDown = false;
let recycleRequested = false;
let uncertainStopRequested = false;

class FatalWorkerError extends Error {}

const HEAVY_JOB_TYPES = new Set([
  "phase0.generate_packet",
  "phase.generate_packet",
  "code.generate_mvp",
  "research.generate_report",
  "research.tech_news_refresh",
  "browser.check_page",
  "runtime.provision_project",
]);

const REALTIME_JOB_TYPES = new Set(["chat.reply"]);

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

type WorkerHeartbeatStatus = "running" | "draining" | "stopped" | "error";

async function writeWorkerHeartbeat(
  db: ReturnType<typeof createAdminSupabase>,
  cfg: ReturnType<typeof getWorkerConfig>,
  input: {
    status: WorkerHeartbeatStatus;
    startedAt: string;
    jobsProcessed: number;
    consecutivePollErrors: number;
    memory?: ReturnType<typeof formatMemorySnapshot>;
    details?: Record<string, unknown>;
  },
) {
  const nowIso = new Date().toISOString();
  const memory = input.memory ?? formatMemorySnapshot();

  const payload: Record<string, unknown> = {
    worker_id: cfg.workerId,
    service_name: cfg.workerServiceName,
    status: input.status,
    started_at: input.startedAt,
    last_seen_at: nowIso,
    jobs_processed: input.jobsProcessed,
    consecutive_poll_errors: input.consecutivePollErrors,
    rss_mb: Number(memory.rssMb.toFixed(2)),
    heap_used_mb: Number(memory.heapUsedMb.toFixed(2)),
    heap_total_mb: Number(memory.heapTotalMb.toFixed(2)),
    external_mb: Number(memory.externalMb.toFixed(2)),
    updated_at: nowIso,
  };
  if (input.details) {
    payload.details = input.details;
  }

  const { error } = await db.from("worker_heartbeats").upsert(payload, { onConflict: "worker_id" });

  if (error) {
    console.error("[worker] heartbeat write error:", error.message);
  }
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
    .select("id,attempts,max_attempts,locked_at,locked_by")
    .eq("status", "running")
    .lt("locked_at", cutoff)
    .limit(Math.max(100, cfg.claimBatch * 10));
  if (stale.error) {
    throw new Error(`fallback stale query failed: ${stale.error.message}`);
  }

  const rows = (stale.data ?? []) as StaleJobSnapshot[];
  return reclaimSnapshots(db, rows, cutoff);

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
          let changed = false;
          try { changed = await transitionOwnedJob(db, job, cfg.workerId, {
            status: "failed", last_error: "Unknown job type", locked_at: null,
            locked_by: null, completed_at: new Date().toISOString(),
          }); } catch { shuttingDown = true; console.error("[worker] job transition failed; draining"); }
          if (changed) {
            try { await emitJobEvent(db, { projectId: job.project_id, jobId: job.id, type: "status", message: "failed: unknown job type" }); }
            catch { console.error("[worker] job event unavailable"); }
          } else console.warn("[worker] unknown job no longer owned; no transition");
          continue;
        }

        await emitJobEvent(db, {
          projectId: job.project_id,
          jobId: job.id,
          type: "status",
          message: "running",
        });

        await runWithTimeoutQuarantine(
          () => handler(db, job),
          cfg.jobTimeoutMs,
          async () => {
            try { await quarantineAttempt(db, job, cfg.workerId); }
            catch { shuttingDown = true; throw new Error("Job quarantine failed"); }
          },
        );

        let completed = false;
        try { completed = await transitionOwnedJob(db, job, cfg.workerId, {
          status: "completed", last_error: null, locked_at: null, locked_by: null,
          completed_at: new Date().toISOString(),
        }); } catch { shuttingDown = true; console.error("[worker] completion transition failed; draining"); }
        if (completed) {
          try { await emitJobEvent(db, { projectId: job.project_id, jobId: job.id, type: "status", message: "completed" }); }
          catch { console.error("[worker] job event unavailable"); }
        } else console.warn("[worker] completed job no longer owned; no transition");
      } catch (err: unknown) {
        if (err instanceof QuarantinedTimeout) {
          if (err.quarantineFailed) {
            // The status could not be fenced. Stop claiming after other workers drain.
            shuttingDown = true;
            console.error("[worker] timeout quarantine failed; draining");
          } else {
            console.warn("[worker] timed-out job quarantined; reconcile before retry");
          }
          shuttingDown = true;
          uncertainStopRequested = true;
          continue;
        }
        const msg = "Job failed; outcome may be uncertain. Reconcile before retry.";

        // Any handler failure may follow an external side effect. Never auto-replay it.
        const payload = uncertainFailurePayload();
        let changed = false;
        try { changed = await transitionOwnedJob(db, job, cfg.workerId, payload); }
        catch { shuttingDown = true; console.error("[worker] job transition failed; draining"); }
        if (changed) {
          try { await emitJobEvent(db, { projectId: job.project_id, jobId: job.id, type: "status", message: "failed", data: { error: msg } }); }
          catch { console.error("[worker] job event unavailable"); }
        } else console.warn("[worker] failed job no longer owned or transition unavailable");

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
  const heartbeatDb = createAdminSupabase();
  const startedAtIso = new Date().toISOString();
  let heartbeatStatus: WorkerHeartbeatStatus = "running";
  let lastHeartbeatAt = 0;
  const renderCommit = process.env.RENDER_GIT_COMMIT;
  console.log(JSON.stringify({
    event: "worker_startup",
    node_version: process.version,
    render_git_commit: renderCommit && /^[0-9a-f]{40}$/i.test(renderCommit) ? renderCommit : null,
    worker_id: cfg.workerId,
    concurrency: cfg.concurrency,
    claim_batch: cfg.claimBatch,
    heavy_concurrency: cfg.heavyConcurrency,
    max_jobs_per_process: cfg.maxJobsPerProcess,
  }));

  await writeWorkerHeartbeat(heartbeatDb, cfg, {
    status: "running",
    startedAt: startedAtIso,
    jobsProcessed: 0,
    consecutivePollErrors: 0,
    details: {
      event: "startup",
    },
  });

  process.on("SIGTERM", () => {
    console.log("[worker] SIGTERM received, draining...");
    shuttingDown = true;
    heartbeatStatus = "draining";
  });
  process.on("SIGINT", () => {
    console.log("[worker] SIGINT received, draining...");
    shuttingDown = true;
    heartbeatStatus = "draining";
  });

  let lastReclaim = 0;
  let consecutivePollErrors = 0;
  let lastPollError: string | null = null;
  let processedJobs = 0;
  let lastMemoryLogAt = 0;
  let nextSleepMs = cfg.pollMs;

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

    if (now - lastHeartbeatAt >= cfg.heartbeatIntervalMs) {
      const heartbeatDetails =
        consecutivePollErrors > 0
          ? {
              poll_error_streak: consecutivePollErrors,
              last_poll_error: (lastPollError ?? "").slice(0, 500),
              next_retry_ms: nextSleepMs,
            }
          : undefined;

      await writeWorkerHeartbeat(heartbeatDb, cfg, {
        status: heartbeatStatus,
        startedAt: startedAtIso,
        jobsProcessed: processedJobs,
        consecutivePollErrors,
        memory,
        details: heartbeatDetails,
      });
      lastHeartbeatAt = now;
    }

    if (now - lastReclaim > cfg.reclaimIntervalMs) {
      try {
        const db = createAdminSupabase();
        const staleThresholdMinutes = Math.max(
          10,
          Math.ceil((cfg.jobTimeoutMs + 120_000) / 60_000),
        );
        const rpcResult = await db.rpc("reclaim_stale_jobs", {
          p_stale_threshold: `${staleThresholdMinutes} minutes`,
        });
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
      lastPollError = null;
      nextSleepMs = cfg.pollMs;
      if (ran > 0) {
        processedJobs += ran;
        console.log(`[worker] processed ${ran} jobs`);
      }
      if (cfg.maxJobsPerProcess > 0 && processedJobs >= cfg.maxJobsPerProcess) {
        console.warn(`[worker] scheduled recycle after ${processedJobs} jobs`);
        // runOnce has joined all handlers, including timed-out work.
        shuttingDown = true;
        heartbeatStatus = "draining";
        recycleRequested = true;
      }
    } catch (e) {
      if (e instanceof FatalWorkerError) {
        throw e;
      }
      consecutivePollErrors += 1;
      const pollErrorMessage =
        e instanceof Error ? e.message : "Unknown worker poll error";
      lastPollError = pollErrorMessage;
      nextSleepMs = Math.min(
        cfg.pollErrorBackoffMaxMs,
        cfg.pollMs * Math.max(1, 2 ** Math.min(consecutivePollErrors, 6)),
      );
      console.error(
        `[worker] poll error (${consecutivePollErrors}): ${pollErrorMessage}`,
      );
      if (
        cfg.maxConsecutivePollErrors > 0 &&
        consecutivePollErrors >= cfg.maxConsecutivePollErrors
      ) {
        throw new Error(
          `[worker] exiting after ${consecutivePollErrors} consecutive poll errors (max=${cfg.maxConsecutivePollErrors})`
        );
      }
    }

    await sleep(nextSleepMs);
  }

  if (uncertainStopRequested) {
    // Do not let an unavailable heartbeat DB prevent bounded process shutdown.
    await Promise.race([
      writeWorkerHeartbeat(heartbeatDb, cfg, {
        status: "error", startedAt: startedAtIso, jobsProcessed: processedJobs,
        consecutivePollErrors, details: { event: "uncertain_timeout" },
      }).catch(() => {}),
      sleep(2_000),
    ]);
    process.exit(1);
  }
  await writeWorkerHeartbeat(heartbeatDb, cfg, {
    status: "stopped", startedAt: startedAtIso, jobsProcessed: processedJobs,
    consecutivePollErrors, details: { event: "shutdown" },
  });

  console.log("[worker] shutdown complete");
  if (recycleRequested) process.exit(0);
}

main().catch(async (e) => {
  console.error("[worker] fatal:", e);
  try {
    const db = createAdminSupabase();
    const cfg = getWorkerConfig();
    await writeWorkerHeartbeat(db, cfg, {
      status: "error",
      startedAt: new Date().toISOString(),
      jobsProcessed: 0,
      consecutivePollErrors: 0,
      details: {
        event: "fatal",
        error: e instanceof Error ? e.message : "unknown",
      },
    });
  } catch {}
  process.exit(1);
});
