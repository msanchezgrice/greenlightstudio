import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { StudioNav } from "@/components/studio-nav";
import { ProjectChatPane } from "@/components/project-chat-pane";
import { TechNewsRefreshButton } from "@/components/tech-news-refresh-button";
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

type RecommendationEventRow = {
  created_at: string;
  data: {
    recommendations?: Array<{
      priority?: number;
      description?: string;
      approval_action_type?: string | null;
    }>;
    approvals_queued?: number;
  } | null;
};

type TechNewsEventRow = {
  created_at: string;
  data: {
    asset_id?: string | null;
    summary_preview?: string | null;
    advances_count?: number | null;
  } | null;
};

type TechNewsAssetFallbackRow = {
  id: string;
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

function clampPhaseRoute(phase: number) {
  return Math.max(0, Math.min(3, phase));
}

function renderLinkedText(text: string | null | undefined) {
  if (!text) return null;
  const pattern = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(pattern);
  if (parts.length === 1) return text;
  return parts.map((part, index) => {
    if (!/^https?:\/\/[^\s]+$/i.test(part)) return <span key={`txt-${index}`}>{part}</span>;
    return (
      <a key={`url-${index}`} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    );
  });
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

  const [
    { total: pendingCount },
    projectQuery,
    approvalsQuery,
    tasksQuery,
    packetQuery,
    recommendationEventQuery,
    techNewsEventQuery,
    techNewsAssetFallbackQuery,
  ] = await Promise.all([
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
    withRetry(() =>
      db
        .from("project_events")
        .select("created_at,data")
        .eq("project_id", projectId)
        .eq("event_type", "nightshift.recommendations_generated")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
    withRetry(() =>
      db
        .from("project_events")
        .select("created_at,data")
        .eq("project_id", projectId)
        .eq("event_type", "research.tech_news_refreshed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
    withRetry(() =>
      db
        .from("project_assets")
        .select("id,created_at")
        .eq("project_id", projectId)
        .eq("filename", "tech-news-insights.md")
        .eq("status", "uploaded")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
  ]);

  if (projectQuery.error || !projectQuery.data) {
    return (
      <>
        <StudioNav active="board" pendingCount={pendingCount} />
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
  const latestRecommendationEvent = (recommendationEventQuery.data as RecommendationEventRow | null) ?? null;
  const recommendations = Array.isArray(latestRecommendationEvent?.data?.recommendations)
    ? latestRecommendationEvent?.data?.recommendations ?? []
    : [];
  const topRecommendations = recommendations.slice(0, 3);
  const latestTechNewsEvent = (techNewsEventQuery.data as TechNewsEventRow | null) ?? null;
  const techNewsFallbackAsset = (techNewsAssetFallbackQuery.data as TechNewsAssetFallbackRow | null) ?? null;
  const eventTechNewsAssetId =
    typeof latestTechNewsEvent?.data?.asset_id === "string" && latestTechNewsEvent.data.asset_id.trim().length > 0
      ? latestTechNewsEvent.data.asset_id
      : null;
  const techNewsAssetId =
    eventTechNewsAssetId ?? (techNewsFallbackAsset?.id ?? null);
  const techNewsSummary =
    typeof latestTechNewsEvent?.data?.summary_preview === "string"
      ? latestTechNewsEvent.data.summary_preview
      : null;
  const techNewsAdvances =
    typeof latestTechNewsEvent?.data?.advances_count === "number"
      ? latestTechNewsEvent.data.advances_count
      : null;
  const techNewsGeneratedAt = latestTechNewsEvent?.created_at ?? techNewsFallbackAsset?.created_at ?? null;

  const tasksByPhase = new Map<PhaseId, TaskRow[]>();
  for (const phase of PHASES) tasksByPhase.set(phase.id, []);

  for (const task of tasks) {
    const phase = taskPhase(task.description);
    if (phase === null) continue;
    const list = tasksByPhase.get(phase) ?? [];
    list.push(task);
    tasksByPhase.set(phase, list);
  }

  const activePhase = clampPhaseRoute(project.phase);
  const activePacket = packets.find((row) => row.phase === activePhase) ?? null;
  const runningTaskCount = tasks.filter((item) => item.status === "running").length;
  const pendingApprovalCount = approvals.filter((item) => item.status === "pending").length;
  const chatLinks: Array<{ label: string; href: string; external?: boolean }> = [
    { label: "Phase Overview", href: `/projects/${projectId}/phases` },
    { label: "Current Workspace", href: `/projects/${projectId}/phases/${activePhase}` },
    { label: "Approvals Inbox", href: `/inbox?project=${projectId}` },
  ];
  if (techNewsAssetId) {
    chatLinks.unshift({
      label: "Tech + AI News",
      href: `/api/projects/${projectId}/assets/${techNewsAssetId}/preview`,
      external: true,
    });
  }
  if (project.live_url) {
    chatLinks.unshift({ label: "Live Landing", href: project.live_url, external: true });
  }

  return (
    <>
      <StudioNav active="board" pendingCount={pendingCount} />
      <main className="page studio-page studio-page-with-chat">
        <div className="studio-with-chat">
          <div className="studio-main-column">
            <div className="page-header">
              <div>
                <h1 className="page-title">{project.name} · Startup Machine Phases</h1>
                <p className="meta-line">
                  {project.domain ?? "No domain"} · runtime {project.runtime_mode} · updated {new Date(project.updated_at).toLocaleString()}
                </p>
              </div>
              <div className="table-actions">
                <Link href={`/projects/${projectId}/logs`} className="btn btn-details">
                  Project Log
                </Link>
                <Link href="/inbox" className="btn btn-preview">
                  Inbox
                </Link>
              </div>
            </div>

            <section className="studio-card">
              <h2>Pipeline</h2>
              <div className="phase-linear-track">
                {PHASES.map((phase, index) => {
                  const status = phaseStatus(project.phase, phase.id);
                  const isComplete = status === "completed";
                  const isActive = status === "active";
                  const phasePacket = packets.find((row) => row.phase === phase.id) ?? null;
                  const progressLabel = isComplete
                    ? "Completed"
                    : isActive
                      ? `In Progress${phasePacket ? ` · ${phasePacket.confidence}%` : ""}`
                      : "Upcoming";
                  return (
                    <div key={phase.id} className="phase-linear-node-wrap">
                      <Link href={`/projects/${projectId}/phases/${phase.id}`} className={`phase-linear-node ${status}`}>
                        <span className="phase-linear-dot">{isComplete ? "✓" : phase.id}</span>
                        <span className="phase-linear-text">
                          <span className="phase-linear-title">{phase.title}</span>
                          <span className="phase-linear-state">{progressLabel}</span>
                        </span>
                      </Link>
                      {index < PHASES.length - 1 && (
                        <div className={`phase-linear-connector ${isComplete ? "complete" : ""}`} />
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="meta-line" style={{ marginTop: 10 }}>
                Current phase: {activePhase} · confidence {activePacket ? `${activePacket.confidence}/100` : "--"}.
              </p>
            </section>

            <section className="studio-card">
              <h2>Status Summary</h2>
              <p className="meta-line">
                {project.name} is in Phase {activePhase} with {pendingApprovalCount} pending approvals, {runningTaskCount} running tasks, and latest pitch deck confidence{" "}
                {activePacket ? `${activePacket.confidence}/100` : "not generated"}.
              </p>
              {topRecommendations.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div className="metric-label">Top Recommendations</div>
                  <ul style={{ margin: "8px 0 0 16px", padding: 0, color: "var(--text2)", lineHeight: 1.5 }}>
                    {topRecommendations.map((rec, index) => (
                      <li key={`phase-summary-rec-${index}`}>{rec.description ?? "No description"}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="studio-card">
              <h2>Tech + AI News</h2>
              {!techNewsAssetId ? (
                <>
                  <p className="meta-line">No tech-news insight has been generated yet.</p>
                  <div className="card-actions" style={{ marginTop: 12 }}>
                    <TechNewsRefreshButton
                      projectId={projectId}
                      autoOnMount
                      generatedAt={techNewsGeneratedAt}
                      staleAfterMinutes={0}
                    />
                  </div>
                </>
              ) : (
                <>
                  <p className="meta-line" style={{ marginBottom: 10 }}>
                    {techNewsSummary ?? "Latest technical and AI advances relevant to this project."}
                  </p>
                  <div className="project-metrics">
                    <div>
                      <div className="metric-label">Generated</div>
                      <div className="metric-value">{new Date(techNewsGeneratedAt ?? new Date().toISOString()).toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="metric-label">Advances Tracked</div>
                      <div className="metric-value">{techNewsAdvances ?? "--"}</div>
                    </div>
                  </div>
                  <div className="card-actions" style={{ marginTop: 12 }}>
                    <TechNewsRefreshButton
                      projectId={projectId}
                      autoOnMount
                      generatedAt={techNewsGeneratedAt}
                      staleAfterMinutes={0}
                    />
                    <a
                      href={`/api/projects/${projectId}/assets/${techNewsAssetId}/preview`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-details"
                    >
                      Open Tech + AI News Brief
                    </a>
                  </div>
                </>
              )}
            </section>

            {PHASES.map((phase) => {
              const status = phaseStatus(project.phase, phase.id);
              const phaseTasks = (tasksByPhase.get(phase.id) ?? []).slice(0, 12);
              const visibleTasks = phaseTasks.slice(0, 3);
              const hiddenTasks = phaseTasks.slice(3);
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
                      <div className="metric-label">Pitch Deck Confidence</div>
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
                      <>
                        <div className="table-shell">
                          <table className="studio-table compact">
                            <thead>
                              <tr>
                                <th className="col-task">Task</th>
                                <th className="col-agent">Agent</th>
                                <th className="col-status">Status</th>
                                <th className="col-created">Created</th>
                              </tr>
                            </thead>
                            <tbody>
                              {visibleTasks.map((task) => {
                                const agent = getAgentProfile(task.agent);
                                return (
                                  <tr key={task.id}>
                                    <td className="col-task">
                                      <div className="table-main">{humanizeTaskDescription(task.description)}</div>
                                      <div className="table-sub">{renderLinkedText(task.detail)}</div>
                                    </td>
                                    <td className="col-agent">
                                      <span className="agent-inline-label" style={{ color: agent.color, fontWeight: 600 }}>
                                        {agent.icon} {agent.name}
                                      </span>
                                    </td>
                                    <td className={`col-status ${taskClass(task.status)}`}>{task.status}</td>
                                    <td className="col-created">{new Date(task.created_at).toLocaleString()}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {hiddenTasks.length > 0 && (
                          <details className="phase-task-collapse">
                            <summary>Show {hiddenTasks.length} more task{hiddenTasks.length === 1 ? "" : "s"}</summary>
                            <div className="table-shell" style={{ marginTop: 8 }}>
                              <table className="studio-table compact">
                                <thead>
                                  <tr>
                                    <th className="col-task">Task</th>
                                    <th className="col-agent">Agent</th>
                                    <th className="col-status">Status</th>
                                    <th className="col-created">Created</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {hiddenTasks.map((task) => {
                                    const agent = getAgentProfile(task.agent);
                                    return (
                                      <tr key={task.id}>
                                        <td className="col-task">
                                          <div className="table-main">{humanizeTaskDescription(task.description)}</div>
                                          <div className="table-sub">{renderLinkedText(task.detail)}</div>
                                        </td>
                                        <td className="col-agent">
                                          <span className="agent-inline-label" style={{ color: agent.color, fontWeight: 600 }}>
                                            {agent.icon} {agent.name}
                                          </span>
                                        </td>
                                        <td className={`col-status ${taskClass(task.status)}`}>{task.status}</td>
                                        <td className="col-created">{new Date(task.created_at).toLocaleString()}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        )}
                      </>
                    )}
                  </div>

                  <div className="card-actions">
                    <Link href={`/projects/${projectId}/phases/${phase.id}`} className="btn btn-details">
                      Open Workspace
                    </Link>
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
          </div>

          <aside className="studio-chat-rail">
            <ProjectChatPane projectId={projectId} title="CEO Agent" deliverableLinks={chatLinks} />
          </aside>
        </div>
      </main>
    </>
  );
}
