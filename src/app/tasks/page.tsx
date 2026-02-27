import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { StudioNav } from "@/components/studio-nav";
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
      <StudioNav active="tasks" pendingCount={pendingCount} />
      <main className="page studio-page">
        <div className="page-header">
          <h1 className="page-title">Tasks &amp; Logs</h1>
        </div>

        {!projects.length ? (
          <section className="studio-card">
            <h2>No projects yet</h2>
            <p className="meta-line">Create a project first to generate tasks and logs.</p>
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
