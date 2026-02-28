export function getWorkerConfig() {
  return {
    workerId: process.env.WORKER_ID ?? "worker-local",
    concurrency: Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 3)),
    pollMs: Math.max(250, Number(process.env.WORKER_POLL_MS ?? 1000)),
    claimBatch: Math.max(1, Number(process.env.WORKER_CLAIM_BATCH ?? 5)),
    reclaimIntervalMs: Math.max(10_000, Number(process.env.WORKER_RECLAIM_INTERVAL_MS ?? 60_000)),
  };
}
