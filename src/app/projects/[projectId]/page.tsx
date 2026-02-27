import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { createServiceSupabase } from "@/lib/supabase";
import { StudioNav } from "@/components/studio-nav";
import { ProjectChatPane } from "@/components/project-chat-pane";
import { RetryTaskButton } from "@/components/retry-task-button";
import { getOwnedProjects, getPendingApprovalsByProject, getPacketsByProject, getProjectAssets } from "@/lib/studio";
import type { ProjectPacketRow, ProjectAssetRow } from "@/lib/studio";
import { withRetry } from "@/lib/retry";
import { getAgentProfile, humanizeTaskDescription, taskOutputHref } from "@/lib/phases";

type ApprovalRow = {
  id: string;
  title: string;
  risk: "high" | "medium" | "low";
  status: "pending" | "approved" | "denied" | "revised";
  created_at: string;
};

type TaskRow = {
  id: string;
  agent: string;
  description: string;
  status: "queued" | "running" | "completed" | "failed";
  detail: string | null;
  created_at: string;
};

type NightShiftSummaryRow = {
  id: string;
  detail: string | null;
  created_at: string;
};

type ProjectPermissions = {
  repo_write?: boolean;
  deploy?: boolean;
  email_send?: boolean;
  ads_enabled?: boolean;
  ads_budget_cap?: number;
};

function riskClass(risk: ApprovalRow["risk"]) {
  if (risk === "high") return "bad";
  if (risk === "medium") return "warn";
  return "good";
}

function statusClass(status: string) {
  if (status === "failed" || status === "denied") return "bad";
  if (status === "running" || status === "queued" || status === "revised" || status === "pending") return "warn";
  return "good";
}

function phaseLabel(phase: number) {
  if (phase <= 0) return "Phase 0";
  if (phase === 1) return "Phase 1";
  if (phase === 2) return "Phase 2";
  if (phase === 3) return "Phase 3";
  return "Launched";
}

function assetKindLabel(kind: string) {
  const labels: Record<string, string> = {
    upload: "Upload",
    landing_html: "Landing Page",
    email_template: "Email Template",
    ads_creative: "Ad Creative",
    release_note: "Release Note",
    packet_export: "Packet Export",
  };
  return labels[kind] ?? kind;
}

function formatBytes(bytes: number | null) {
  if (bytes === null || bytes === 0) return "--";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function phaseRoute(phase: number) {
  return Math.min(3, Math.max(0, phase));
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return null;

  const { projectId } = await params;
  const db = createServiceSupabase();

  const projects = await getOwnedProjects(userId);
  const projectIds = projects.map((project) => project.id);
  const [{ total: pendingCount }, projectQuery, approvalsQuery, tasksQuery, packetQuery, nightShiftSummaryQuery, nightShiftFailuresQuery, allPackets, projectAssets] =
    await Promise.all([
    getPendingApprovalsByProject(projectIds),
    withRetry(() =>
      db
        .from("projects")
        .select("id,name,domain,repo_url,phase,runtime_mode,permissions,night_shift,focus_areas,created_at,updated_at")
        .eq("id", projectId)
        .eq("owner_clerk_id", userId)
        .maybeSingle(),
    ),
    withRetry(() =>
      db
        .from("approval_queue")
        .select("id,title,risk,status,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(20),
    ),
    withRetry(() =>
      db
        .from("tasks")
        .select("id,agent,description,status,detail,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(30),
    ),
    withRetry(() =>
      db
        .from("phase_packets")
        .select("phase,confidence,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
    withRetry(() =>
      db
        .from("tasks")
        .select("id,detail,created_at")
        .eq("project_id", projectId)
        .eq("agent", "night_shift")
        .eq("description", "nightshift_summary")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
    withRetry(() =>
      db
        .from("tasks")
        .select("id,detail,created_at")
        .eq("project_id", projectId)
        .eq("agent", "night_shift")
        .eq("status", "failed")
        .order("created_at", { ascending: false })
        .limit(3),
    ),
    getPacketsByProject(projectId),
    getProjectAssets(projectId),
  ]);

  if (projectQuery.error || !projectQuery.data) {
    return (
      <>
        <StudioNav active="projects" pendingCount={pendingCount} />
        <main className="page studio-page">
          <section className="studio-card">
            <h2>Project not found</h2>
            <p className="meta-line">This project does not exist or is not accessible.</p>
          </section>
        </main>
      </>
    );
  }

  const project = projectQuery.data;
  const approvals = (approvalsQuery.data ?? []) as ApprovalRow[];
  const tasks = (tasksQuery.data ?? []) as TaskRow[];
  const packet = packetQuery.data;
  const permissions = (project.permissions as ProjectPermissions | null) ?? {};
  const nightShiftSummary = (nightShiftSummaryQuery.data as NightShiftSummaryRow | null) ?? null;
  const nightShiftFailures = (nightShiftFailuresQuery.data ?? []) as NightShiftSummaryRow[];

  return (
    <>
      <StudioNav active="projects" pendingCount={pendingCount} />
      <main className="page studio-page">
        <div className="page-header">
          <div>
            <h1 className="page-title">{project.name}</h1>
            <p className="meta-line">{project.domain ?? "No domain"}</p>
          </div>
          <div className="table-actions">
            <Link href={`/projects/${projectId}/phases`} className="btn btn-details">
              Phase Dashboard
            </Link>
            <Link href={`/projects/${projectId}/phases/${phaseRoute(project.phase)}`} className="btn btn-preview">
              Active Phase Workspace
            </Link>
            {packet ? (
              <Link href={`/projects/${projectId}/packet`} className="btn btn-preview">
                Open Packet
              </Link>
            ) : (
              <span className="btn btn-preview btn-disabled" aria-disabled="true">
                Open Packet
              </span>
            )}
            <Link href="/inbox" className="btn btn-details">
              Open Inbox
            </Link>
          </div>
        </div>

        <section className="studio-card project-meta-grid">
          <div>
            <div className="metric-label">Phase</div>
            <div className="metric-value">{phaseLabel(project.phase)}</div>
          </div>
          <div>
            <div className="metric-label">Runtime</div>
            <div className="metric-value">{project.runtime_mode === "attached" ? "Attached" : "Shared"}</div>
          </div>
          <div>
            <div className="metric-label">Latest Packet</div>
            <div className="metric-value">{packet ? `${packet.confidence}/100` : "Not generated"}</div>
          </div>
          <div>
            <div className="metric-label">Night Shift</div>
            <div className={`metric-value ${project.night_shift ? "good" : "tone-muted"}`}>{project.night_shift ? "Enabled" : "Disabled"}</div>
          </div>
          <div>
            <div className="metric-label">Repo</div>
            <div className="metric-value">{project.repo_url ?? "None"}</div>
          </div>
          <div>
            <div className="metric-label">Focus Areas</div>
            <div className="metric-value">{project.focus_areas?.length ? project.focus_areas.join(", ") : "None"}</div>
          </div>
        </section>

        <section className="studio-card">
          <h2>Permission Ladder</h2>
          <div className="project-metrics">
            <div>
              <div className="metric-label">Repo Write</div>
              <div className={`metric-value ${permissions.repo_write ? "good" : "tone-muted"}`}>{permissions.repo_write ? "On" : "Off"}</div>
            </div>
            <div>
              <div className="metric-label">Deploy</div>
              <div className={`metric-value ${permissions.deploy ? "good" : "tone-muted"}`}>{permissions.deploy ? "On" : "Off"}</div>
            </div>
            <div>
              <div className="metric-label">Email</div>
              <div className={`metric-value ${permissions.email_send ? "good" : "tone-muted"}`}>{permissions.email_send ? "On" : "Off"}</div>
            </div>
            <div>
              <div className="metric-label">Ads Budget</div>
              <div className="metric-value">{permissions.ads_enabled ? `$${Number(permissions.ads_budget_cap ?? 0)}/day` : "$0/day"}</div>
            </div>
          </div>
        </section>

        <section className="studio-card">
          <h2>While You Were Away</h2>
          {!nightShiftSummary ? (
            <p className="meta-line">No completed Night Shift summary yet.</p>
          ) : (
            <>
              <p className="meta-line">{nightShiftSummary.detail ?? "Night Shift summary available."}</p>
              <p className="meta-line">Generated {new Date(nightShiftSummary.created_at).toLocaleString()}</p>
            </>
          )}
          {nightShiftFailures.length > 0 && (
            <div className="table-shell" style={{ marginTop: 10 }}>
              <table className="studio-table compact">
                <thead>
                  <tr>
                    <th>Recent Night Shift Failures</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {nightShiftFailures.map((failure) => (
                    <tr key={failure.id}>
                      <td>{failure.detail ?? "Night Shift task failed."}</td>
                      <td>{new Date(failure.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="studio-card">
          <h2>Phases &amp; Packets</h2>
          {!allPackets.length ? (
            <p className="meta-line">No packets generated yet across any phase.</p>
          ) : (
            <div className="table-shell">
              <table className="studio-table compact">
                <thead>
                  <tr>
                    <th>Phase</th>
                    <th>Confidence</th>
                    <th>Generated</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {allPackets.map((pkt) => (
                    <tr key={pkt.id}>
                      <td>{phaseLabel(pkt.phase)}</td>
                      <td className={pkt.confidence >= 70 ? "good" : pkt.confidence >= 40 ? "warn" : "bad"}>
                        {pkt.confidence}/100
                      </td>
                      <td>{new Date(pkt.created_at).toLocaleString()}</td>
                      <td>
                        {pkt.phase === 0 ? (
                          <Link href={`/projects/${projectId}/packet`} className="btn btn-details btn-sm">
                            View Packet
                          </Link>
                        ) : (
                          <Link href={`/projects/${projectId}/phases/${pkt.phase}`} className="btn btn-details btn-sm">
                            View Phase
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="card-actions" style={{ marginTop: 12 }}>
            <Link href={`/projects/${projectId}/phases`} className="btn btn-details">
              Full Phase Dashboard
            </Link>
          </div>
        </section>

        <section className="studio-card">
          <h2>Generated Assets</h2>
          {!projectAssets.length ? (
            <p className="meta-line">No assets generated yet for this project.</p>
          ) : (
            <div className="table-shell">
              <table className="studio-table compact">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Type</th>
                    <th>Phase</th>
                    <th>Size</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {projectAssets.map((asset) => (
                    <tr key={asset.id}>
                      <td>{asset.filename}</td>
                      <td>{assetKindLabel(asset.kind)}</td>
                      <td>{asset.phase !== null ? phaseLabel(asset.phase) : "--"}</td>
                      <td>{formatBytes(asset.size_bytes)}</td>
                      <td className={statusClass(asset.status)}>{asset.status}</td>
                      <td>{new Date(asset.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="studio-card">
          <h2>Latest Approvals</h2>
          {!approvals.length ? (
            <p className="meta-line">No approvals yet.</p>
          ) : (
            <div className="table-shell">
              <table className="studio-table compact">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Risk</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {approvals.map((approval) => (
                    <tr key={approval.id}>
                      <td>{approval.title}</td>
                      <td className={riskClass(approval.risk)}>{approval.risk}</td>
                      <td className={statusClass(approval.status)}>{approval.status}</td>
                      <td>{new Date(approval.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="studio-card">
          <h2>Latest Tasks</h2>
          {!tasks.length ? (
            <p className="meta-line">No tasks yet.</p>
          ) : (
            <div className="table-shell">
              <table className="studio-table compact">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Task</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => {
                    const agent = getAgentProfile(task.agent);
                    const outputHref = taskOutputHref(task.description, projectId);
                    return (
                      <tr key={task.id}>
                        <td>
                          <span style={{ color: agent.color, fontWeight: 600 }}>
                            {agent.icon} {agent.name}
                          </span>
                        </td>
                        <td>
                          <div className="table-main">{humanizeTaskDescription(task.description)}</div>
                          <div className="table-sub">{task.detail ?? ""}</div>
                        </td>
                        <td className={statusClass(task.status)}>{task.status}</td>
                        <td>{new Date(task.created_at).toLocaleString()}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {task.status === "failed" && (
                            <RetryTaskButton projectId={projectId} />
                          )}
                          {task.status === "completed" && outputHref && (
                            <Link href={outputHref} className="btn btn-details btn-sm">
                              View output
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <ProjectChatPane projectId={projectId} title="CEO Chat Pane" />
      </main>
    </>
  );
}
