import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase";
import { log_task } from "@/lib/supabase-mcp";
import { withRetry } from "@/lib/retry";
import { requireEnv } from "@/lib/env";

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const nightShiftSecret = process.env.NIGHT_SHIFT_SECRET;
  const url = new URL(req.url);
  const provided = req.headers.get("x-night-shift-secret") ?? url.searchParams.get("secret");
  const authHeader = req.headers.get("authorization");
  const authorizedByCron = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);
  const authorizedByNightShift = Boolean(nightShiftSecret && provided === nightShiftSecret);

  if (!authorizedByCron && !authorizedByNightShift) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    requireEnv("ANTHROPIC_API_KEY");
  } catch {
    return NextResponse.json({ error: "Anthropic key missing" }, { status: 500 });
  }

  const db = createServiceSupabase();

  const { data: projects, error: projectsError } = await withRetry(() =>
    db
      .from("projects")
      .select("id,name,night_shift")
      .eq("night_shift", true)
      .order("updated_at", { ascending: true })
      .limit(50),
  );

  if (projectsError) {
    return NextResponse.json({ error: projectsError.message }, { status: 400 });
  }

  const results: Array<{ project_id: string; status: string; detail: string }> = [];

  for (const project of projects ?? []) {
    const projectId = project.id as string;

    try {
      await withRetry(() => log_task(projectId, "night_shift", "nightshift_health_check", "running", "Health check started"));

      const { count: pendingApprovals, error: approvalsError } = await withRetry(() =>
        db
          .from("approval_queue")
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId)
          .eq("status", "pending"),
      );

      if (approvalsError) {
        throw new Error(approvalsError.message);
      }

      if ((pendingApprovals ?? 0) > 0) {
        await withRetry(() =>
          log_task(
            projectId,
            "night_shift",
            "nightshift_skipped",
            "completed",
            `Skipped: ${pendingApprovals} pending approvals in inbox`,
          ),
        );

        results.push({
          project_id: projectId,
          status: "skipped",
          detail: `Pending approvals: ${pendingApprovals}`,
        });
        continue;
      }

      const { data: recentTasks, error: recentError } = await withRetry(() =>
        db
          .from("tasks")
          .select("status")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(20),
      );

      if (recentError) {
        throw new Error(recentError.message);
      }

      const completedCount = (recentTasks ?? []).filter((task) => task.status === "completed").length;
      const failedCount = (recentTasks ?? []).filter((task) => task.status === "failed").length;

      await withRetry(() =>
        log_task(
          projectId,
          "night_shift",
          "nightshift_summary",
          "completed",
          `While You Were Away: ${completedCount} completed, ${failedCount} failed tasks in recent window`,
        ),
      );

      if (failedCount > 0) {
        const { error: queueError } = await withRetry(() =>
          db.from("approval_queue").insert({
            project_id: projectId,
            phase: 0,
            type: "phase_advance",
            title: "Night Shift Failure Review",
            description: `Night Shift detected ${failedCount} failed tasks. Review before next cycle.`,
            risk: "medium",
            risk_level: "medium",
            action_type: "nightshift_failure_review",
            agent_source: "night_shift",
            payload: { failed_count: failedCount },
          }),
        );

        if (queueError) {
          throw new Error(queueError.message);
        }
      }

      results.push({
        project_id: projectId,
        status: "completed",
        detail: `Summary generated (completed=${completedCount}, failed=${failedCount})`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Night Shift error";
      await withRetry(() => log_task(projectId, "night_shift", "nightshift_failed", "failed", message));
      results.push({ project_id: projectId, status: "failed", detail: message });
    }
  }

  return NextResponse.json({ ran_at: new Date().toISOString(), project_count: projects?.length ?? 0, results });
}
