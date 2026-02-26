import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { StudioNav } from "@/components/studio-nav";
import {
  getLatestPacketsByProject,
  getLatestTasksByProject,
  getOwnedProjects,
  getPendingApprovalsByProject,
} from "@/lib/studio";

function phaseLabel(phase: number) {
  if (phase <= 0) return "Phase 0";
  if (phase === 1) return "Phase 1";
  if (phase === 2) return "Phase 2";
  if (phase === 3) return "Phase 3";
  return "Launched";
}

function phaseRoute(phase: number) {
  return Math.min(3, Math.max(0, phase));
}

function taskStatusClass(status: string) {
  if (status === "completed") return "good";
  if (status === "failed") return "bad";
  if (status === "running") return "warn";
  return "tone-muted";
}

export default async function BoardPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const projects = await getOwnedProjects(userId);
  const projectIds = projects.map((project) => project.id);
  const [{ total: pendingCount, byProject: pendingByProject }, latestPackets, latestTasks] = await Promise.all([
    getPendingApprovalsByProject(projectIds),
    getLatestPacketsByProject(projectIds),
    getLatestTasksByProject(projectIds),
  ]);

  const nightShiftEnabled = projects.filter((project) => project.night_shift).length;
  const confidences = projects
    .map((project) => latestPackets.get(project.id)?.confidence)
    .filter((confidence): confidence is number => typeof confidence === "number");
  const avgConfidence = confidences.length
    ? Math.round(confidences.reduce((sum, confidence) => sum + confidence, 0) / confidences.length)
    : null;

  return (
    <>
      <StudioNav active="board" pendingCount={pendingCount} />
      <main className="page studio-page">
        <div className="page-header">
          <h1 className="page-title">Studio Board</h1>
          <Link href="/onboarding?new=1" className="btn btn-approve">
            New Project
          </Link>
        </div>

        <div className="studio-stats">
          <div className="studio-stat">
            <div className="studio-stat-value">{projects.length}</div>
            <div className="studio-stat-label">Projects</div>
          </div>
          <div className="studio-stat">
            <div className="studio-stat-value warn">{pendingCount}</div>
            <div className="studio-stat-label">Pending Approvals</div>
          </div>
          <div className="studio-stat">
            <div className="studio-stat-value">{nightShiftEnabled}</div>
            <div className="studio-stat-label">Night Shift Enabled</div>
          </div>
          <div className="studio-stat">
            <div className="studio-stat-value good">{avgConfidence ?? "--"}</div>
            <div className="studio-stat-label">Avg Packet Confidence</div>
          </div>
        </div>

        {!projects.length && (
          <section className="studio-card">
            <h2>No projects yet</h2>
            <p className="meta-line">Run onboarding to create your first project and generate a Phase 0 packet.</p>
          </section>
        )}

        <section className="project-grid">
          {projects.map((project) => {
            const packet = latestPackets.get(project.id);
            const task = latestTasks.get(project.id);
            const pending = pendingByProject.get(project.id) ?? 0;

            return (
              <article key={project.id} className="studio-card project-card">
                <div className="project-card-top">
                  <div>
                    <h2>{project.name}</h2>
                    <p className="meta-line">{project.domain ?? "No domain"}</p>
                  </div>
                  <span className="phase-chip">{phaseLabel(project.phase)}</span>
                </div>

                <div className="project-metrics">
                  <div>
                    <div className="metric-label">Runtime</div>
                    <div className="metric-value">{project.runtime_mode === "attached" ? "Attached" : "Shared"}</div>
                  </div>
                  <div>
                    <div className="metric-label">Pending Inbox</div>
                    <div className={`metric-value ${pending > 0 ? "warn" : "good"}`}>{pending}</div>
                  </div>
                  <div>
                    <div className="metric-label">Latest Confidence</div>
                    <div className="metric-value">{packet ? `${packet.confidence}/100` : "--"}</div>
                  </div>
                </div>

                <div className="project-last-task">
                  <div className="metric-label">Latest Task</div>
                  {task ? (
                    <div>
                      <div className="metric-value">{task.description}</div>
                      <div className={`meta-line ${taskStatusClass(task.status)}`}>
                        {task.status}
                        {task.detail ? ` · ${task.detail}` : ""}
                      </div>
                    </div>
                  ) : (
                    <div className="meta-line">No tasks yet</div>
                  )}
                </div>

                <div className="card-actions">
                  <Link href={`/projects/${project.id}`} className="btn btn-details">
                    Open
                  </Link>
                  <Link href={`/projects/${project.id}/phases/${phaseRoute(project.phase)}`} className="btn btn-preview">
                    Active Phase
                  </Link>
                  <Link href={`/projects/${project.id}/phases`} className="btn btn-details">
                    Phases
                  </Link>
                  <Link href={`/projects/${project.id}/packet`} className="btn btn-preview">
                    Packet
                  </Link>
                  <Link href="/inbox" className="btn btn-details">
                    Inbox
                  </Link>
                </div>
              </article>
            );
          })}
        </section>
      </main>
    </>
  );
}
