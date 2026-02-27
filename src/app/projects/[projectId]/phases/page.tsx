import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { StudioNav } from "@/components/studio-nav";
import { getOwnedProjects, getPendingApprovalsByProject } from "@/lib/studio";
import { PHASES, phaseStatus, taskPhase, getAgentProfile, humanizeTaskDescription, type PhaseId } from "@/lib/phases";

type ProjectRow = {
  id: string;
  name: string;
  domain: string | null;
  phase: number;
  runtime_mode: "shared" | "attached";
  live_url: string | null;
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

const phaseColorMap: Record<number, { gradient: string; border: string; glow: string; accent: string }> = {
  0: { gradient: "linear-gradient(135deg, #22c55e12, #22c55e06)", border: "#22c55e44", glow: "0 0 20px rgba(34,197,94,0.08)", accent: "#22c55e" },
  1: { gradient: "linear-gradient(135deg, #3b82f612, #3b82f606)", border: "#3b82f644", glow: "0 0 20px rgba(59,130,246,0.08)", accent: "#3b82f6" },
  2: { gradient: "linear-gradient(135deg, #a855f712, #a855f706)", border: "#a855f744", glow: "0 0 20px rgba(168,85,247,0.08)", accent: "#a855f7" },
  3: { gradient: "linear-gradient(135deg, #eab30812, #eab30806)", border: "#eab30844", glow: "0 0 20px rgba(234,179,8,0.08)", accent: "#eab308" },
};

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
        .select("id,name,domain,phase,runtime_mode,live_url,updated_at")
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
              const colors = phaseColorMap[phase.id] ?? phaseColorMap[0];
              const isActive = status === "active";
              const isComplete = status === "completed";
              return (
                <Link
                  key={phase.id}
                  href={`/projects/${projectId}/phases/${phase.id}`}
                  className={`phase-node ${phaseChip(status)}`}
                  style={{
                    background: isActive || isComplete ? colors.gradient : undefined,
                    borderColor: isActive ? colors.border : isComplete ? colors.border : undefined,
                    boxShadow: isActive ? colors.glow : undefined,
                    textDecoration: "none",
                    transition: "all 0.3s ease",
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  {isActive && (
                    <div style={{
                      position: "absolute", top: 0, left: 0, right: 0, height: 3,
                      background: `linear-gradient(90deg, ${colors.accent}, ${colors.accent}88)`,
                    }} />
                  )}
                  <div className="phase-node-label" style={isActive ? { color: colors.accent } : undefined}>
                    {phase.label}
                  </div>
                  <div className="phase-node-title">{phase.title}</div>
                  <div className="phase-node-status" style={isActive ? { color: colors.accent, fontWeight: 700 } : undefined}>
                    {isActive ? "● " : ""}{status}
                  </div>
                </Link>
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

          const sectionColors = phaseColorMap[phase.id] ?? phaseColorMap[0];

          return (
            <section
              key={phase.id}
              className="studio-card"
              style={status === "active" ? {
                borderColor: sectionColors.border,
                background: sectionColors.gradient,
                boxShadow: sectionColors.glow,
              } : undefined}
            >
              <div className="phase-header">
                <div>
                  <h2 style={status === "active" ? { color: sectionColors.accent } : undefined}>
                    {phase.label} · {phase.title}
                  </h2>
                  <p className="meta-line">{phase.summary}</p>
                </div>
                <div
                  className={`phase-pill ${phaseChip(status)}`}
                  style={status === "active" ? {
                    background: `${sectionColors.accent}18`,
                    color: sectionColors.accent,
                    borderColor: sectionColors.accent,
                  } : undefined}
                >
                  {status}
                </div>
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
                        {phaseTasks.map((task) => {
                          const agent = getAgentProfile(task.agent);
                          return (
                            <tr key={task.id}>
                              <td>
                                <div className="table-main">{humanizeTaskDescription(task.description)}</div>
                                <div className="table-sub">{task.detail ?? ""}</div>
                              </td>
                              <td>
                                <span style={{ color: agent.color, fontWeight: 600 }}>
                                  {agent.icon} {agent.name}
                                </span>
                              </td>
                              <td className={taskClass(task.status)}>{task.status}</td>
                              <td>{new Date(task.created_at).toLocaleString()}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="card-actions">
                <Link href={`/projects/${projectId}/phases/${phase.id}`} className="btn btn-details">
                  Open Workspace
                </Link>
                {packet ? (
                  phase.id === 0 ? (
                    <Link href={`/projects/${projectId}/packet`} className="btn btn-preview">
                      Open Packet
                    </Link>
                  ) : (
                    <Link href={`/projects/${projectId}/phases/${phase.id}`} className="btn btn-preview">
                      View Packet
                    </Link>
                  )
                ) : (
                  <span className="btn btn-preview btn-disabled" aria-disabled="true">
                    No Packet
                  </span>
                )}
                {phase.id === 1 && project.live_url && (
                  <a
                    href={project.live_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-approve"
                  >
                    View Landing Page
                  </a>
                )}
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
