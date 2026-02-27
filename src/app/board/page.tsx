import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { StudioNav } from "@/components/studio-nav";
import { LiveRefresh } from "@/components/live-refresh";
import { BoardContent, type ProjectRow } from "@/components/board-content";
import { BoardStats } from "@/components/board-stats";
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
      live_url: p.live_url ?? null,
    };
  });

  return (
    <>
      <StudioNav
        active="board"
        pendingCount={pendingCount}
        runningCount={runningTasks.size}
      />
      <LiveRefresh intervalMs={10000} hasActiveWork={runningTasks.size > 0} />
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

        <BoardStats
          projectCount={projects.length}
          pendingCount={pendingCount}
          packetCount={packetCount}
          nightShiftCount={nightShiftEnabled}
          avgConfidence={avgConfidence}
        />

        {!projects.length ? (
          <section className="zero-state">
            <div className="zero-state-icon">▲</div>
            <h2 className="zero-state-title">Welcome to Startup Machine</h2>
            <p className="zero-state-desc">
              Create your first project to generate AI-powered decision packets with market sizing,
              competitor analysis, and confidence scores.
            </p>
            <div className="zero-state-actions">
              <Link href="/onboarding?new=1" className="btn btn-approve" style={{ padding: "10px 24px", fontSize: 14 }}>
                Create Your First Project
              </Link>
              <Link href="/bulk-import" className="btn btn-details" style={{ padding: "10px 24px", fontSize: 14 }}>
                Bulk Import
              </Link>
            </div>
          </section>
        ) : (
          <>
            <BoardContent
              projects={projectRows}
              packetCount={packetCount}
              runningAgents={Array.from(runningTasks.entries()).map(([pid, t]) => ({
                projectId: pid,
                projectName: projects.find((p) => p.id === pid)?.name ?? pid,
                agent: t.agent,
                description: t.description,
              }))}
            />
            <RecentActivity items={recentActivity} />
          </>
        )}
      </main>
    </>
  );
}
