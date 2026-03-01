import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 30;

type WorkerHeartbeatRow = {
  worker_id: string;
  service_name: string;
  status: "running" | "draining" | "stopped" | "error";
  started_at: string | null;
  last_seen_at: string;
  jobs_processed: number;
  consecutive_poll_errors: number;
  rss_mb: number | null;
  heap_used_mb: number | null;
  heap_total_mb: number | null;
  external_mb: number | null;
  details: Record<string, unknown> | null;
  updated_at: string;
};

function healthSecret() {
  return process.env.WORKER_HEALTH_SECRET?.trim() || process.env.CRON_SECRET?.trim() || null;
}

function isAuthorized(req: Request) {
  const secret = healthSecret();
  if (!secret) return false;

  const url = new URL(req.url);
  const direct = req.headers.get("x-worker-health-secret")?.trim() || url.searchParams.get("secret")?.trim();
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return direct === secret || bearer === secret;
}

function toAgeSeconds(iso: string) {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((Date.now() - ts) / 1000));
}

function staleThresholdSeconds() {
  const raw = Number(process.env.WORKER_HEARTBEAT_STALE_SECONDS ?? 120);
  if (!Number.isFinite(raw)) return 120;
  return Math.max(30, Math.floor(raw));
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceSupabase();
  const staleSeconds = staleThresholdSeconds();
  const nowIso = new Date().toISOString();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const [workersRes, failedRes, timeoutRes] = await Promise.all([
    db
      .from("worker_heartbeats")
      .select(
        "worker_id,service_name,status,started_at,last_seen_at,jobs_processed,consecutive_poll_errors,rss_mb,heap_used_mb,heap_total_mb,external_mb,details,updated_at",
      )
      .order("last_seen_at", { ascending: false })
      .limit(20),
    db
      .from("agent_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("created_at", oneHourAgo),
    db
      .from("agent_jobs")
      .select("id", { count: "exact", head: true })
      .ilike("last_error", "%timed out%")
      .gte("created_at", oneHourAgo),
  ]);

  if (workersRes.error) {
    return NextResponse.json({ error: workersRes.error.message }, { status: 500 });
  }

  const rows = (workersRes.data ?? []) as WorkerHeartbeatRow[];
  const workers = rows.map((row) => {
    const ageSeconds = toAgeSeconds(row.last_seen_at);
    const isStale = ageSeconds > staleSeconds;
    return {
      worker_id: row.worker_id,
      service_name: row.service_name,
      status: row.status,
      started_at: row.started_at,
      last_seen_at: row.last_seen_at,
      age_seconds: ageSeconds,
      is_stale: isStale,
      jobs_processed: row.jobs_processed,
      consecutive_poll_errors: row.consecutive_poll_errors,
      memory_mb: {
        rss: row.rss_mb,
        heap_used: row.heap_used_mb,
        heap_total: row.heap_total_mb,
        external: row.external_mb,
      },
      details: row.details ?? {},
      updated_at: row.updated_at,
    };
  });

  const healthyWorkers = workers.filter(
    (worker) => !worker.is_stale && (worker.status === "running" || worker.status === "draining"),
  );
  const staleWorkers = workers.filter((worker) => worker.is_stale);

  const recentFailedJobs = failedRes.count ?? 0;
  const recentTimeoutFailures = timeoutRes.count ?? 0;

  const status =
    workers.length === 0
      ? "down"
      : healthyWorkers.length === 0
        ? "down"
        : staleWorkers.length > 0
          ? "degraded"
          : "healthy";

  let diagnosis = "Worker health is normal.";
  if (status === "down" && recentTimeoutFailures > 0) {
    diagnosis = "No fresh worker heartbeat and recent timeout errors detected; investigate worker runtime/logs.";
  } else if (status === "down") {
    diagnosis = "No fresh worker heartbeat detected.";
  } else if (recentFailedJobs > 0) {
    diagnosis = "Worker heartbeat is healthy; failures are likely job-level rather than process downtime.";
  }

  return NextResponse.json({
    checked_at: nowIso,
    status,
    stale_threshold_seconds: staleSeconds,
    summary: {
      workers_total: workers.length,
      workers_healthy: healthyWorkers.length,
      workers_stale: staleWorkers.length,
      recent_failed_jobs_1h: recentFailedJobs,
      recent_timeout_failures_1h: recentTimeoutFailures,
      diagnosis,
    },
    workers,
  });
}
