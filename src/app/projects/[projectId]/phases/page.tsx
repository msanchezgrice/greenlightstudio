import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { StudioNav } from "@/components/studio-nav";
import { getOwnedProjects, getPendingApprovalsByProject } from "@/lib/studio";
import { PHASES, phaseStatus, taskPhase, type PhaseId } from "@/lib/phases";

type ProjectRow = {
  id: string;
  name: string;
  domain: string | null;
  phase: number;
  runtime_mode: "shared" | "attached";
  updated_at: string;
};

type ApprovalRow = {
  id: string;
  phase: number;
  action_type: string;
  title: string;
  status: "pending" | "approved" | "denied" | "revised";
  created_at: string;
};

type TaskRow = {
  id: string;
  description: string;
  agent: string;
  status: "queued" | "running" | "completed" | "failed";
  detail: string | null;
  created_at: string;
};

type PacketRow = {
  phase: number;
  confidence: number;
  created_at: string;
};

function gateClass(status: ApprovalRow["status"] | null) {
  if (status === "approved") return "good";
  if (status === "pending" || status === "revised") return "warn";
  if (status === "denied") return "bad";
  return "tone-muted";
}

function taskClass(status: TaskRow["status"]) {
  if (status === "completed") return "good";
  if (status === "running" || status === "queued") return "warn";
  if (status === "failed") return "bad";
  return "tone-muted";
}

function phaseChip(status: string) {
  if (status === "completed") return "phase-complete";
  if (status === "active") return "phase-active";
  return "phase-upcoming";
}

export default async function ProjectPhasesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return null;

  const { projectId } = await params;
  const db = createServiceSupabase();

  const projects = await getOwnedProjects(userId);
  const projectIds = projects.map((project) => project.id);

  const [{ total: pendingCount }, projectQuery, approvalsQuery, tasksQuery, packetQuery] = await Promise.all([
    getPendingApprovalsByProject(projectIds),
    withRetry(() =>
      db
        .from("projects")
        .select("id,name,domain,phase,runtime_mode,updated_at")
        .eq("id", projectId)
        .eq("owner_clerk_id", userId)
        .maybeSingle(),
    ),
    withRetry(() =>
      db
        .from("approval_queue")
        .select("id,phase,action_type,title,status,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(100),
    ),
    withRetry(() =>
      db
        .from("tasks")
        .select("id,description,agent,status,detail,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(300),
    ),
    withRetry(() =>
      db
        .from("phase_packets")
        .select("phase,confidence,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(10),
    ),
  ]);

  if (projectQuery.error || !projectQuery.data) {
    return (
      <>
        <StudioNav active="projects" pendingCount={pendingCount} />
        <main className="page studio-page">
          <section className="studio-card">
            <h2>Project not found</h2>
            <p className="meta-line">Unable to load phase dashboard for this project.</p>
          </section>
        </main>
      </>
    );
  }

  const project = projectQuery.data as ProjectRow;
  const approvals = (approvalsQuery.data ?? []) as ApprovalRow[];
  const tasks = (tasksQuery.data ?? []) as TaskRow[];
  const packets = (packetQuery.data ?? []) as PacketRow[];

  const tasksByPhase = new Map<PhaseId, TaskRow[]>();
  for (const phase of PHASES) tasksByPhase.set(phase.id, []);

  for (const task of tasks) {
    const phase = taskPhase(task.description);
    if (phase === null) continue;
    const list = tasksByPhase.get(phase) ?? [];
    list.push(task);
    tasksByPhase.set(phase, list);
  }

  return (
    <>
      <StudioNav active="projects" pendingCount={pendingCount} />
      <main className="page studio-page">
        <div className="page-header">
          <div>
            <h1 className="page-title">{project.name} · Startup Machine Phases</h1>
            <p className="meta-line">
              {project.domain ?? "No domain"} · runtime {project.runtime_mode} · updated {new Date(project.updated_at).toLocaleString()}
            </p>
          </div>
          <div className="table-actions">
            <Link href={`/projects/${projectId}`} className="btn btn-details">
              Project
            </Link>
            <Link href="/inbox" className="btn btn-preview">
              Inbox
            </Link>
          </div>
        </div>

        <section className="studio-card">
          <h2>Pipeline</h2>
          <div className="phase-track">
            {PHASES.map((phase) => {
              const status = phaseStatus(project.phase, phase.id);
              return (
                <div key={phase.id} className={`phase-node ${phaseChip(status)}`}>
                  <div className="phase-node-label">{phase.label}</div>
                  <div className="phase-node-title">{phase.title}</div>
                  <div className="phase-node-status">{status}</div>
                </div>
              );
            })}
          </div>
        </section>

        {PHASES.map((phase) => {
          const status = phaseStatus(project.phase, phase.id);
          const phaseTasks = (tasksByPhase.get(phase.id) ?? []).slice(0, 12);
          const gate = approvals.find((row) => row.phase === phase.id && row.action_type === phase.gateActionType) ?? null;
          const packet = packets.find((row) => row.phase === phase.id) ?? null;

          const completed = phaseTasks.filter((task) => task.status === "completed").length;
          const running = phaseTasks.filter((task) => task.status === "running").length;
          const queued = phaseTasks.filter((task) => task.status === "queued").length;
          const failed = phaseTasks.filter((task) => task.status === "failed").length;

          return (
            <section key={phase.id} className="studio-card">
              <div className="phase-header">
                <div>
                  <h2>{phase.label} · {phase.title}</h2>
                  <p className="meta-line">{phase.summary}</p>
                </div>
                <div className={`phase-pill ${phaseChip(status)}`}>{status}</div>
              </div>

              <div className="project-metrics">
                <div>
                  <div className="metric-label">Gate</div>
                  <div className={`metric-value ${gateClass(gate?.status ?? null)}`}>{gate?.status ?? "not created"}</div>
                </div>
                <div>
                  <div className="metric-label">Completed</div>
                  <div className="metric-value good">{completed}</div>
                </div>
                <div>
                  <div className="metric-label">Running</div>
                  <div className="metric-value warn">{running}</div>
                </div>
                <div>
                  <div className="metric-label">Queued</div>
                  <div className="metric-value tone-muted">{queued}</div>
                </div>
                <div>
                  <div className="metric-label">Failed</div>
                  <div className="metric-value bad">{failed}</div>
                </div>
                <div>
                  <div className="metric-label">Packet Confidence</div>
                  <div className="metric-value">{packet ? `${packet.confidence}/100` : "--"}</div>
                </div>
              </div>

              <div className="phase-section">
                <div className="phase-subtitle">Deliverables</div>
                <div className="phase-deliverables">
                  {phase.deliverables.map((item) => (
                    <span key={item} className="deliverable-chip">{item}</span>
                  ))}
                </div>
              </div>

              <div className="phase-section">
                <div className="phase-subtitle">Latest Tasks</div>
                {!phaseTasks.length ? (
                  <p className="meta-line">No tasks logged for this phase yet.</p>
                ) : (
                  <div className="table-shell">
                    <table className="studio-table compact">
                      <thead>
                        <tr>
                          <th>Task</th>
                          <th>Agent</th>
                          <th>Status</th>
                          <th>Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {phaseTasks.map((task) => (
                          <tr key={task.id}>
                            <td>
                              <div className="table-main">{task.description}</div>
                              <div className="table-sub">{task.detail ?? "No detail"}</div>
                            </td>
                            <td>{task.agent}</td>
                            <td className={taskClass(task.status)}>{task.status}</td>
                            <td>{new Date(task.created_at).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="card-actions">
                <Link href={`/projects/${projectId}/phases/${phase.id}`} className="btn btn-details">
                  Open Workspace
                </Link>
                {phase.id === 0 &&
                  (packet ? (
                    <Link href={`/projects/${projectId}/packet`} className="btn btn-preview">
                      Open Packet
                    </Link>
                  ) : (
                    <span className="btn btn-preview btn-disabled" aria-disabled="true">
                      Open Packet
                    </span>
                  ))}
                {gate?.status === "pending" && (
                  <Link href="/inbox" className="btn btn-details">
                    Review Gate in Inbox
                  </Link>
                )}
              </div>
            </section>
          );
        })}
      </main>
    </>
  );
}
