export function getWorkerConfig() {
  const requestedConcurrency = Number(process.env.WORKER_CONCURRENCY ?? 3);
  const concurrency = Math.max(2, Number.isFinite(requestedConcurrency) ? requestedConcurrency : 3);
  const requestedClaimBatch = Number(process.env.WORKER_CLAIM_BATCH ?? concurrency * 2);
  const claimBatch = Math.max(concurrency, Number.isFinite(requestedClaimBatch) ? requestedClaimBatch : concurrency * 2);
  const requestedHeavyConcurrency = Number(process.env.WORKER_HEAVY_CONCURRENCY ?? 1);
  const heavyConcurrency = Math.max(1, Number.isFinite(requestedHeavyConcurrency) ? requestedHeavyConcurrency : 1);
  return {
    workerId: process.env.WORKER_ID ?? "worker-local",
    concurrency,
    pollMs: Math.max(250, Number(process.env.WORKER_POLL_MS ?? 400)),
    claimBatch,
    heavyConcurrency,
    reclaimIntervalMs: Math.max(10_000, Number(process.env.WORKER_RECLAIM_INTERVAL_MS ?? 60_000)),
    jobTimeoutMs: Math.max(60_000, Number(process.env.WORKER_JOB_TIMEOUT_MS ?? 900_000)),
    // Disabled by default to avoid intentional process exits that trigger host-level crash alerts.
    maxJobsPerProcess: Math.max(0, Number(process.env.WORKER_MAX_JOBS_PER_PROCESS ?? 0)),
    maxRssMb: Math.max(0, Number(process.env.WORKER_MAX_RSS_MB ?? 700)),
    memoryLogIntervalMs: Math.max(10_000, Number(process.env.WORKER_MEMORY_LOG_INTERVAL_MS ?? 60_000)),
  };
}
