import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { StudioNav } from "@/components/studio-nav";
import { BoardContent, type ProjectRow } from "@/components/board-content";
import { RecentActivity } from "@/components/recent-activity";
import {
  getLatestPacketsByProject,
  getLatestTasksByProject,
  getOwnedProjects,
  getPacketCount,
  getPendingApprovalsByProject,
  getRecentActivity,
  getRunningTasks,
} from "@/lib/studio";

export default async function BoardPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const projects = await getOwnedProjects(userId);
  const projectIds = projects.map((p) => p.id);

  const [
    { total: pendingCount, byProject: pendingByProject },
    latestPackets,
    latestTasks,
    packetCount,
    runningTasks,
    recentActivity,
  ] = await Promise.all([
    getPendingApprovalsByProject(projectIds),
    getLatestPacketsByProject(projectIds),
    getLatestTasksByProject(projectIds),
    getPacketCount(projectIds),
    getRunningTasks(projectIds),
    getRecentActivity(userId),
  ]);

  const nightShiftEnabled = projects.filter((p) => p.night_shift).length;
  const confidences = projects
    .map((p) => latestPackets.get(p.id)?.confidence)
    .filter((c): c is number => typeof c === "number");
  const avgConfidence = confidences.length
    ? Math.round(confidences.reduce((sum, c) => sum + c, 0) / confidences.length)
    : null;

  const projectRows: ProjectRow[] = projects.map((p) => {
    const packet = latestPackets.get(p.id);
    const task = latestTasks.get(p.id);
    const running = runningTasks.get(p.id);
    const pending = pendingByProject.get(p.id) ?? 0;

    return {
      id: p.id,
      name: p.name,
      domain: p.domain,
      phase: p.phase,
      night_shift: p.night_shift,
      confidence: packet?.confidence ?? null,
      packet_phase: packet?.phase ?? null,
      pending,
      running_agent: running?.agent ?? null,
      running_desc: running?.description ?? null,
      latest_task_status: task?.status ?? null,
      latest_task_desc: task?.description ?? null,
    };
  });

  return (
    <>
      <StudioNav active="board" pendingCount={pendingCount} />
      <main className="page studio-page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Studio Board</h1>
            <p className="meta-line">
              All projects across every phase — live progress, confidence scores, and agent activity.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/bulk-import" className="btn btn-details">
              Bulk Import
            </Link>
            <Link href="/onboarding?new=1" className="btn btn-approve">
              New Project
            </Link>
          </div>
        </div>

        <div className="studio-stats">
          <div className="studio-stat">
            <div className="studio-stat-value" style={{ color: "var(--green)" }}>
              {projects.length}
            </div>
            <div className="studio-stat-label">Active Projects</div>
          </div>
          <div className="studio-stat">
            <div className="studio-stat-value warn">{pendingCount}</div>
            <div className="studio-stat-label">Pending Approvals</div>
          </div>
          <div className="studio-stat">
            <div className="studio-stat-value" style={{ color: "var(--purple)" }}>
              {packetCount}
            </div>
            <div className="studio-stat-label">Packets Generated</div>
          </div>
          <div className="studio-stat">
            <div className="studio-stat-value" style={{ color: "#3B82F6" }}>
              {nightShiftEnabled}
            </div>
            <div className="studio-stat-label">Night Shift Enabled</div>
          </div>
          <div className="studio-stat">
            <div className="studio-stat-value good">{avgConfidence ?? "--"}</div>
            <div className="studio-stat-label">Avg Confidence</div>
          </div>
        </div>

        {!projects.length && (
          <section className="studio-card">
            <h2>No projects yet</h2>
            <p className="meta-line">
              Run onboarding to create your first project and generate a Phase 0 packet.
            </p>
          </section>
        )}

        <BoardContent projects={projectRows} packetCount={packetCount} />

        <RecentActivity items={recentActivity} />
      </main>
    </>
  );
}
