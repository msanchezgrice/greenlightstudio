import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { StudioNav } from "@/components/studio-nav";
import { LiveRefresh } from "@/components/live-refresh";
import { createServiceSupabase } from "@/lib/supabase";
import { getOwnedProjects, getPendingApprovalsByProject } from "@/lib/studio";
import { withRetry } from "@/lib/retry";
import { AnimatedTaskQueue } from "@/components/animated-task-queue";

type TaskRow = {
  id: string;
  project_id: string;
  agent: string;
  description: string;
  status: "queued" | "running" | "completed" | "failed";
  detail: string | null;
  created_at: string;
};

type TaskLogRow = {
  id: string;
  project_id: string;
  step: string;
  status: string;
  detail: string | null;
  created_at: string;
};

export default async function TasksPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const db = createServiceSupabase();
  const projects = await getOwnedProjects(userId);
  const projectIds = projects.map((project) => project.id);
  const projectNameMap = Object.fromEntries(projects.map((project) => [project.id, project.name]));

  const [{ total: pendingCount }, tasksQuery, logQuery] = await Promise.all([
    getPendingApprovalsByProject(projectIds),
    projectIds.length
      ? withRetry(() =>
          db
            .from("tasks")
            .select("id,project_id,agent,description,status,detail,created_at")
            .in("project_id", projectIds)
            .order("created_at", { ascending: false })
            .limit(200),
        )
      : Promise.resolve({ data: [], error: null }),
    projectIds.length
      ? withRetry(() =>
          db
            .from("task_log")
            .select("id,project_id,step,status,detail,created_at")
            .in("project_id", projectIds)
            .order("created_at", { ascending: false })
            .limit(200),
        )
      : Promise.resolve({ data: [], error: null }),
  ]);

  const tasks = (tasksQuery.data ?? []) as TaskRow[];
  const logRows = (logQuery.data ?? []) as TaskLogRow[];

  return (
    <>
      <StudioNav active="tasks" pendingCount={pendingCount} runningCount={tasks.filter((t) => t.status === "running").length} />
      <LiveRefresh intervalMs={8000} hasActiveWork={tasks.some((t) => t.status === "running")} activeIntervalMs={3000} />
      <main className="page studio-page">
        <div className="page-header">
          <h1 className="page-title">Tasks &amp; Logs</h1>
        </div>

        {!projects.length ? (
          <section className="zero-state">
            <div className="zero-state-icon">⚡</div>
            <h2 className="zero-state-title">No Tasks Yet</h2>
            <p className="zero-state-desc">
              When your AI agents start working on projects, their tasks and activity logs will appear here in real time.
            </p>
            <div className="zero-state-actions">
              <Link href="/onboarding?new=1" className="btn btn-approve" style={{ padding: "10px 24px", fontSize: 14 }}>
                Create a Project
              </Link>
              <Link href="/board" className="btn btn-details" style={{ padding: "10px 24px", fontSize: 14 }}>
                Go to Board
              </Link>
            </div>
          </section>
        ) : (
          <AnimatedTaskQueue
            tasks={tasks}
            logRows={logRows}
            projectNameMap={projectNameMap}
          />
        )}
      </main>
    </>
  );
}
