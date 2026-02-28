import { createAdminSupabase } from "./supabase-admin";
import { getWorkerConfig } from "./worker-config";
import { getHandler, type JobRow } from "./job-handlers";
import { emitJobEvent } from "./job-events";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

let shuttingDown = false;

async function runOnce() {
  const db = createAdminSupabase();
  const cfg = getWorkerConfig();

  const claim = await db.rpc("claim_agent_jobs", {
    p_worker_id: cfg.workerId,
    p_limit: cfg.claimBatch,
  });
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
        await db.rpc("complete_agent_job", {
          p_job_id: job.id,
          p_status: "failed",
          p_error: `Unknown job_type ${job.job_type}`,
        });
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
        await db.rpc("complete_agent_job", {
          p_job_id: job.id,
          p_status: "completed",
          p_error: null,
        });
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

        await db.rpc("complete_agent_job", {
          p_job_id: job.id,
          p_status: "failed",
          p_error: msg,
        });

        const retriable = job.attempts < job.max_attempts;
        if (retriable) {
          const backoffMs = 30_000 * Math.max(1, job.attempts);
          const runAfter = new Date(Date.now() + backoffMs).toISOString();
          await db
            .from("agent_jobs")
            .update({ status: "queued", run_after: runAfter, completed_at: null })
            .eq("id", job.id);
        }
      }
    }
  });

  await Promise.all(workers);
  return { ran: jobs.length };
}

async function main() {
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

  while (!shuttingDown) {
    const now = Date.now();
    if (now - lastReclaim > cfg.reclaimIntervalMs) {
      try {
        const db = createAdminSupabase();
        const result = await db.rpc("reclaim_stale_jobs");
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
      if (ran > 0) {
        console.log(`[worker] processed ${ran} jobs`);
      }
    } catch (e) {
      console.error("[worker] poll error:", e);
    }

    await sleep(cfg.pollMs);
  }

  console.log("[worker] shutdown complete");
}

main().catch((e) => {
  console.error("[worker] fatal:", e);
  process.exit(1);
});
