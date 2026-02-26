import { auth } from "@clerk/nextjs/server";
import { StudioNav } from "@/components/studio-nav";
import { createServiceSupabase } from "@/lib/supabase";
import { getOwnedProjects, getPendingApprovalsByProject } from "@/lib/studio";
import { withRetry } from "@/lib/retry";

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

function statusClass(status: string) {
  if (status === "completed") return "good";
  if (status === "failed") return "bad";
  if (status === "running" || status === "queued") return "warn";
  return "tone-muted";
}

export default async function TasksPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const db = createServiceSupabase();
  const projects = await getOwnedProjects(userId);
  const projectIds = projects.map((project) => project.id);
  const projectNameMap = new Map(projects.map((project) => [project.id, project.name]));

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
          <>
            <section className="studio-card">
              <h2>Task Queue</h2>
              {!tasks.length ? (
                <p className="meta-line">No tasks recorded yet.</p>
              ) : (
                <div className="table-shell">
                  <table className="studio-table compact">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Agent</th>
                        <th>Task</th>
                        <th>Status</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map((task) => (
                        <tr key={task.id}>
                          <td>{projectNameMap.get(task.project_id) ?? task.project_id}</td>
                          <td>{task.agent}</td>
                          <td>
                            <div className="table-main">{task.description}</div>
                            <div className="table-sub">{task.detail ?? "No detail"}</div>
                          </td>
                          <td className={statusClass(task.status)}>{task.status}</td>
                          <td>{new Date(task.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="studio-card">
              <h2>Task Log</h2>
              {!logRows.length ? (
                <p className="meta-line">No task log entries yet.</p>
              ) : (
                <div className="table-shell">
                  <table className="studio-table compact">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Step</th>
                        <th>Status</th>
                        <th>Detail</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logRows.map((entry) => (
                        <tr key={entry.id}>
                          <td>{projectNameMap.get(entry.project_id) ?? entry.project_id}</td>
                          <td>{entry.step}</td>
                          <td className={statusClass(entry.status)}>{entry.status}</td>
                          <td>{entry.detail ?? ""}</td>
                          <td>{new Date(entry.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
