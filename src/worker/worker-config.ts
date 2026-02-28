export function getWorkerConfig() {
  const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 3));
  return {
    workerId: process.env.WORKER_ID ?? "worker-local",
    concurrency,
    pollMs: Math.max(250, Number(process.env.WORKER_POLL_MS ?? 1000)),
    claimBatch: Math.max(1, Number(process.env.WORKER_CLAIM_BATCH ?? concurrency)),
    reclaimIntervalMs: Math.max(10_000, Number(process.env.WORKER_RECLAIM_INTERVAL_MS ?? 60_000)),
  };
}
