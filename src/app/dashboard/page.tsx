import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { StudioNav } from "@/components/studio-nav";
import { LiveRefresh } from "@/components/live-refresh";
import { GreetingStrip } from "@/components/dashboard/greeting-strip";
import { AgentTicker } from "@/components/dashboard/agent-ticker";
import { PhasePipeline } from "@/components/dashboard/phase-pipeline";
import { AttentionPanel } from "@/components/dashboard/attention-panel";
import { MilestonesFeed } from "@/components/dashboard/milestones-feed";
import { NightShiftReport } from "@/components/dashboard/night-shift-report";
import { humanizeTaskDescription } from "@/lib/phases";
import {
  getAllRunningTasks,
  getLatestPacketsByProject,
  getLatestTasksByProject,
  getOwnedProjects,
  getPacketCount,
  getPendingApprovalsByProject,
  getRecentActivity,
  getRecentMilestones,
} from "@/lib/studio";

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const user = await currentUser();
  const userName = user?.firstName ?? "there";

  const projects = await getOwnedProjects(userId);
  const projectIds = projects.map((p) => p.id);
  const projectNameMap = new Map(projects.map((p) => [p.id, p.name]));

  const [
    { total: pendingCount, byProject: pendingByProject },
    latestPackets,
    latestTasks,
    packetCount,
    allRunning,
    recentActivity,
    milestones,
  ] = await Promise.all([
    getPendingApprovalsByProject(projectIds),
    getLatestPacketsByProject(projectIds),
    getLatestTasksByProject(projectIds),
    getPacketCount(projectIds),
    getAllRunningTasks(projectIds),
    getRecentActivity(userId, 12),
    getRecentMilestones(userId, 6),
  ]);

  const confidences = projects
    .map((p) => latestPackets.get(p.id)?.confidence)
    .filter((c): c is number => typeof c === "number");
  const avgConfidence = confidences.length
    ? Math.round(confidences.reduce((sum, c) => sum + c, 0) / confidences.length)
    : null;

  const runningAgents = allRunning.map((r) => ({
    ...r,
    project_name: projectNameMap.get(r.project_id) ?? "Unknown",
  }));

  const tickerItems = [
    ...allRunning.map((r) => ({
      project_id: r.project_id,
      project_name: projectNameMap.get(r.project_id) ?? "Unknown",
      agent: r.agent,
      description: r.description,
    })),
    ...recentActivity
      .filter((a) => a.status === "completed")
      .slice(0, 3)
      .map((a) => ({
        project_id: a.project_id,
        project_name: a.project_name,
        agent: a.agent,
        description: a.description,
        completed: true,
        time_ago: relativeTime(a.created_at),
      })),
  ];

  const pipelineProjects = projects.map((p) => {
    const running = allRunning.find((r) => r.project_id === p.id);
    const task = latestTasks.get(p.id);
    return {
      id: p.id,
      name: p.name,
      phase: p.phase,
      confidence: latestPackets.get(p.id)?.confidence ?? null,
      running_agent: running?.agent ?? null,
      running_desc: running?.description ?? null,
      latest_task_status: task?.status ?? null,
    };
  });

  const attentionItems: Array<{
    type: "failed" | "pending" | "low_confidence";
    project_id: string;
    project_name: string;
    description: string;
    agent: string;
    time_ago: string;
    confidence?: number | null;
  }> = [];

  for (const p of projects) {
    const task = latestTasks.get(p.id);
    const pending = pendingByProject.get(p.id) ?? 0;
    const confidence = latestPackets.get(p.id)?.confidence ?? null;

    if (task?.status === "failed") {
      attentionItems.push({
        type: "failed",
        project_id: p.id,
        project_name: p.name,
        description: humanizeTaskDescription(task.description) + " failed",
        agent: task.agent,
        time_ago: relativeTime(task.created_at),
      });
    }

    if (pending > 0) {
      attentionItems.push({
        type: "pending",
        project_id: p.id,
        project_name: p.name,
        description: `${pending} approval${pending > 1 ? "s" : ""} pending`,
        agent: "ceo_agent",
        time_ago: "",
      });
    }

    if (confidence !== null && confidence < 50 && task?.status !== "failed") {
      attentionItems.push({
        type: "low_confidence",
        project_id: p.id,
        project_name: p.name,
        description: `Low confidence (${confidence}%)`,
        agent: "ceo_agent",
        time_ago: "",
      });
    }
  }

  const nightShiftProjects = projects.filter((p) => p.night_shift);
  const nightShiftActivity = recentActivity
    .filter((a) => nightShiftProjects.some((p) => p.id === a.project_id))
    .filter((a) => {
      const age = Date.now() - new Date(a.created_at).getTime();
      return age < 12 * 60 * 60 * 1000;
    })
    .map((a) => ({
      project_name: a.project_name,
      project_id: a.project_id,
      agent: a.agent,
      description: a.description,
      detail: a.detail,
    }));

  const confidenceColor = avgConfidence === null ? "var(--text3)" : avgConfidence >= 70 ? "var(--green)" : avgConfidence >= 50 ? "var(--yellow)" : "var(--red)";

  return (
    <>
      <StudioNav active="dashboard" pendingCount={pendingCount} runningCount={allRunning.length} />
      <LiveRefresh intervalMs={10000} />
      <main className="page studio-page dash-page">
        {!projects.length ? (
          <section className="zero-state">
            <div className="zero-state-icon">▲</div>
            <h2 className="zero-state-title">Welcome to Startup Machine</h2>
            <p className="zero-state-desc">
              Create your first project to see your executive dashboard come alive with
              real-time agent activity, confidence scores, and pipeline progress.
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
            <GreetingStrip
              userName={userName}
              projectCount={projects.length}
              pendingCount={pendingCount}
              runningAgents={runningAgents}
            />

            <AgentTicker items={tickerItems} />

            <div className="dash-kpi-grid">
              <div className="dash-kpi-card" style={{ "--kpi-accent": "var(--green)" } as React.CSSProperties}>
                <div className="dash-kpi-accent" style={{ background: "linear-gradient(90deg, var(--green), #16a34a)" }} />
                <div className="dash-kpi-value" style={{ color: "var(--green)" }}>{projects.length}</div>
                <div className="dash-kpi-label">Active Projects</div>
              </div>
              <div className="dash-kpi-card">
                <div className="dash-kpi-accent" style={{ background: `linear-gradient(90deg, ${confidenceColor}, ${confidenceColor})` }} />
                <div className="dash-kpi-value" style={{ color: confidenceColor }}>{avgConfidence ?? "—"}</div>
                <div className="dash-kpi-label">Avg Confidence</div>
              </div>
              <div className="dash-kpi-card">
                <div className="dash-kpi-accent" style={{ background: pendingCount > 0 ? "linear-gradient(90deg, var(--yellow), #ca8a04)" : "linear-gradient(90deg, var(--text3), var(--text3))" }} />
                <div className="dash-kpi-value" style={{ color: pendingCount > 0 ? "var(--yellow)" : "var(--text3)" }}>{pendingCount}</div>
                <div className="dash-kpi-label">Pending Approvals</div>
              </div>
              <div className="dash-kpi-card">
                <div className="dash-kpi-accent" style={{ background: "linear-gradient(90deg, var(--purple), #8b5cf6)" }} />
                <div className="dash-kpi-value" style={{ color: "var(--purple)" }}>{packetCount}</div>
                <div className="dash-kpi-label">Packets Generated</div>
              </div>
            </div>

            <PhasePipeline projects={pipelineProjects} />

            <div className="dash-two-col">
              <AttentionPanel items={attentionItems} />
              <MilestonesFeed
                items={milestones.map((m) => ({
                  ...m,
                  confidence: latestPackets.get(m.project_id)?.confidence ?? null,
                }))}
              />
            </div>

            <NightShiftReport items={nightShiftActivity} projectNames={projectNameMap} />
          </>
        )}
      </main>
    </>
  );
}
