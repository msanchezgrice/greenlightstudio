export function getWorkerConfig() {
  // One claim at a time prevents claimed-but-not-started jobs from aging out.
  // This intentionally reduces throughput until renewable leases are implemented.
  const concurrency = 1;
  const claimBatch = 1;
  const heavyConcurrency = 1;
  return {
    workerId: process.env.WORKER_ID ?? "worker-local",
    workerServiceName: process.env.WORKER_SERVICE_NAME?.trim() || "greenlight-worker",
    concurrency,
    pollMs: Math.max(250, Number(process.env.WORKER_POLL_MS ?? 400)),
    claimBatch,
    heavyConcurrency,
    reclaimIntervalMs: Math.max(10_000, Number(process.env.WORKER_RECLAIM_INTERVAL_MS ?? 60_000)),
    jobTimeoutMs: Math.max(60_000, Number(process.env.WORKER_JOB_TIMEOUT_MS ?? 900_000)),
    maxConsecutivePollErrors: Math.max(0, Number(process.env.WORKER_MAX_CONSECUTIVE_POLL_ERRORS ?? 0)),
    pollErrorBackoffMaxMs: Math.max(1_000, Number(process.env.WORKER_POLL_ERROR_BACKOFF_MAX_MS ?? 30_000)),
    // Disabled by default to avoid intentional process exits that trigger host-level crash alerts.
    maxJobsPerProcess: Math.max(0, Number(process.env.WORKER_MAX_JOBS_PER_PROCESS ?? 0)),
    maxRssMb: Math.max(0, Number(process.env.WORKER_MAX_RSS_MB ?? 700)),
    memoryLogIntervalMs: Math.max(10_000, Number(process.env.WORKER_MEMORY_LOG_INTERVAL_MS ?? 60_000)),
    heartbeatIntervalMs: Math.max(5_000, Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? 15_000)),
  };
}
