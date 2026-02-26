"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

/* ---------- Types ---------- */

type BatchProject = {
  id: string;
  name: string;
  domain: string;
  phase: number;
};

type BatchPacket = {
  project_id: string;
  confidence: number | null;
};

type BatchTask = {
  project_id: string;
  status: string;
  agent: string | null;
  description: string | null;
};

type BatchData = {
  batch: { id: string; name: string; status: string; domain_count: number };
  projects: BatchProject[];
  packets: BatchPacket[];
  tasks: BatchTask[];
};

type PipelineStage = "done" | "active" | "refine" | "fail" | "pending";

type ProjectRow = {
  project: BatchProject;
  stages: PipelineStage[];
  statusLabel: string;
  statusClass: string;
  confidence: number | null;
  currentAgent: string;
  agentNote: string | null;
  actionType: "review" | "feedback" | "retry" | "tasks" | "none";
};

/* ---------- Helpers ---------- */

const stageLabels = ["Scan", "Research", "Synthesis", "Packet"];

const statusIcons: Record<string, string> = {
  done: "\u2713",
  run: "\u27F3",
  q: "\u25FB",
  fail: "\u2715",
  refine: "\u21BB",
};

function domainIcon(index: number): string {
  const icons = ["\uD83D\uDE80", "\uD83C\uDFE0", "\uD83E\uDE84", "\uD83C\uDFAF", "\uD83D\uDC8E", "\uD83D\uDCE6", "\uD83E\uDD16", "\uD83D\uDCA1", "\uD83C\uDF1F", "\u26A1"];
  return icons[index % icons.length];
}

function deriveProjectRow(
  project: BatchProject,
  index: number,
  packets: BatchPacket[],
  tasks: BatchTask[],
): ProjectRow {
  const packet = packets.find((p) => p.project_id === project.id);
  const projectTasks = tasks.filter((t) => t.project_id === project.id);
  const latestTask = projectTasks[0] ?? null;
  const hasPacket = Boolean(packet);
  const hasFailed = projectTasks.some((t) => t.status === "failed");
  const isRunning = projectTasks.some((t) => t.status === "running");
  const isRefining = projectTasks.some((t) => t.description?.includes("revision") || t.description?.includes("refine"));

  let stages: PipelineStage[];
  let statusLabel: string;
  let statusClass: string;
  let actionType: ProjectRow["actionType"];
  let agentNote: string | null = null;

  if (hasPacket) {
    stages = ["done", "done", "done", "done"];
    statusLabel = `${statusIcons.done} Packet Ready`;
    statusClass = "done";
    actionType = "review";
  } else if (hasFailed) {
    const failIndex = Math.min(project.phase, 2);
    stages = Array.from({ length: 4 }, (_, i) => (i < failIndex ? "done" : i === failIndex ? "fail" : "pending")) as PipelineStage[];
    statusLabel = `${statusIcons.fail} Failed`;
    statusClass = "fail";
    actionType = "retry";
  } else if (isRefining) {
    const refineIndex = Math.min(project.phase, 1);
    stages = Array.from({ length: 4 }, (_, i) => (i < refineIndex ? "done" : i === refineIndex ? "refine" : "pending")) as PipelineStage[];
    statusLabel = `${statusIcons.refine} Refining`;
    statusClass = "refine";
    actionType = "feedback";
    agentNote = latestTask?.description ?? null;
  } else if (isRunning || project.phase > 0) {
    const activeIndex = Math.min(project.phase, 3);
    stages = Array.from({ length: 4 }, (_, i) => (i < activeIndex ? "done" : i === activeIndex ? "active" : "pending")) as PipelineStage[];
    const stageLabel = activeIndex < stageLabels.length ? stageLabels[activeIndex] : "Processing";
    statusLabel = `${statusIcons.run} ${stageLabel}`;
    statusClass = "run";
    actionType = "tasks";
  } else {
    stages = ["pending", "pending", "pending", "pending"];
    statusLabel = `${statusIcons.q} Queued`;
    statusClass = "q";
    actionType = "none";
  }

  return {
    project,
    stages,
    statusLabel,
    statusClass,
    confidence: packet?.confidence ?? null,
    currentAgent: latestTask?.agent ?? (hasPacket ? "CEO Agent" : "\u2014"),
    agentNote,
    actionType,
  };
}

/* ---------- Component ---------- */

export function BatchProgress({ batchId }: { batchId: string }) {
  const [data, setData] = useState<BatchData | null>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchProgress = useCallback(async () => {
    try {
      const res = await fetch(`/api/batches/${batchId}/progress`);
      if (res.ok) {
        const json = (await res.json()) as BatchData;
        setData(json);
      }
    } catch {
      // Silently retry on next interval
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    fetchProgress();
    intervalRef.current = setInterval(fetchProgress, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchProgress]);

  if (loading || !data) {
    return (
      <div className="page studio-page" style={{ paddingTop: 48 }}>
        <div className="launched-spinner" style={{ margin: "40px auto", width: 24, height: 24 }} />
        <p style={{ textAlign: "center", color: "var(--text2)", fontSize: 13 }}>Loading batch progress...</p>
      </div>
    );
  }

  const { batch, projects, packets, tasks } = data;
  const rows = projects.map((p, i) => deriveProjectRow(p, i, packets, tasks));

  // Summary counts
  const readyCount = rows.filter((r) => r.statusClass === "done").length;
  const runningCount = rows.filter((r) => r.statusClass === "run").length;
  const refiningCount = rows.filter((r) => r.statusClass === "refine").length;
  const queuedCount = rows.filter((r) => r.statusClass === "q").length;
  const failedCount = rows.filter((r) => r.statusClass === "fail").length;
  const totalProjects = rows.length;
  const completedCount = readyCount + failedCount;
  const progressPct = totalProjects > 0 ? Math.round((readyCount / totalProjects) * 100) : 0;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 32px" }}>
      <div className="badge" style={{ marginBottom: 12 }}>BATCH PROGRESS</div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{batch.name}</h1>
      <p style={{ color: "var(--text3)", fontSize: 13, marginBottom: 24 }}>
        {batch.status === "running" ? "Running" : batch.status} &middot; {totalProjects} projects
      </p>

      {/* Summary cards */}
      <div className="batch-summary">
        <div className="studio-stat">
          <div className="studio-stat-value" style={{ color: "var(--green)" }}>{readyCount}</div>
          <div className="studio-stat-label">Packets Ready</div>
        </div>
        <div className="studio-stat">
          <div className="studio-stat-value" style={{ color: "#3B82F6" }}>{runningCount}</div>
          <div className="studio-stat-label">Running</div>
        </div>
        <div className="studio-stat">
          <div className="studio-stat-value" style={{ color: "var(--yellow)" }}>{refiningCount}</div>
          <div className="studio-stat-label">Refining</div>
        </div>
        <div className="studio-stat">
          <div className="studio-stat-value" style={{ color: "var(--text2)" }}>{queuedCount}</div>
          <div className="studio-stat-label">Queued</div>
        </div>
        <div className="studio-stat">
          <div className="studio-stat-value" style={{ color: "var(--red)" }}>{failedCount}</div>
          <div className="studio-stat-label">Failed</div>
        </div>
      </div>

      {/* Overall progress bar */}
      <div className="batch-progress-bar">
        <div className="batch-progress-top">
          <div className="batch-progress-title">Overall Batch Progress</div>
          <div className="batch-progress-text">{progressPct}%</div>
        </div>
        <div className="batch-progress-bg">
          <div className="batch-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="batch-progress-sub">
          <span>{readyCount} of {totalProjects} packets ready</span>
          <span>{queuedCount + runningCount + refiningCount} remaining</span>
        </div>
      </div>

      {/* Legend */}
      <div className="batch-legend">
        <div className="batch-legend-item">
          <div className="batch-legend-dot" style={{ background: "var(--green)" }} />
          Done
        </div>
        <div className="batch-legend-item">
          <div className="batch-legend-dot" style={{ background: "#3B82F6" }} />
          Running
        </div>
        <div className="batch-legend-item">
          <div className="batch-legend-dot" style={{ background: "var(--yellow)" }} />
          Refining (re-run with feedback)
        </div>
        <div className="batch-legend-item">
          <div className="batch-legend-dot" style={{ background: "var(--red)" }} />
          Failed
        </div>
        <div className="batch-legend-item">
          <div className="batch-legend-dot" style={{ background: "var(--border)" }} />
          Pending
        </div>
      </div>

      {/* Progress table */}
      <table className="batch-table">
        <thead>
          <tr>
            <th style={{ width: "18%" }}>Project</th>
            <th style={{ width: "28%" }}>Pipeline</th>
            <th style={{ width: "11%" }}>Status</th>
            <th style={{ width: "9%" }}>Confidence</th>
            <th style={{ width: "15%" }}>Current Agent</th>
            <th style={{ width: "12%" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.project.id}>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      background: "linear-gradient(135deg, #22C55E10, #22C55E20)",
                      flexShrink: 0,
                    }}
                  >
                    {domainIcon(index)}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 12 }}>{row.project.name || row.project.domain}</div>
                    <div style={{ fontSize: 10, color: "var(--text3)" }}>
                      {row.statusClass === "done"
                        ? "Phase 0 complete"
                        : row.statusClass === "fail"
                          ? "Agent returned empty"
                          : row.statusClass === "refine"
                            ? "Re-running with feedback"
                            : row.statusClass === "run"
                              ? "Research running..."
                              : "Waiting in queue"}
                    </div>
                  </div>
                </div>
              </td>
              <td>
                {/* Pipeline labels */}
                <div style={{ display: "flex", alignItems: "center", gap: 2, marginBottom: 4 }}>
                  {stageLabels.map((label) => (
                    <div key={label} style={{ fontSize: 8, color: "var(--text3)", width: 38, textAlign: "center" }}>
                      {label}
                    </div>
                  ))}
                </div>
                {/* Pipeline dots */}
                <div className="batch-pipeline">
                  {row.stages.map((stage, si) => (
                    <div key={si} className={`batch-pip ${stage !== "pending" ? stage : ""}`} />
                  ))}
                </div>
              </td>
              <td>
                <span className={`batch-status ${row.statusClass}`}>{row.statusLabel}</span>
              </td>
              <td>
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: 12,
                    color: row.confidence !== null ? "var(--green)" : "var(--text3)",
                  }}
                >
                  {row.confidence !== null ? row.confidence : "--"}
                </span>
              </td>
              <td>
                <div style={{ color: row.statusClass === "fail" ? "var(--red)" : row.statusClass === "refine" ? "var(--yellow)" : row.statusClass === "run" ? "#3B82F6" : "var(--text3)" }}>
                  {row.currentAgent}
                </div>
                {row.agentNote && (
                  <div style={{ fontSize: 9, color: "var(--text3)", marginTop: 2 }}>&ldquo;{row.agentNote}&rdquo;</div>
                )}
              </td>
              <td>
                {row.actionType === "review" && (
                  <Link href={`/projects/${row.project.id}`} className="batch-action green">
                    Review &rarr;
                  </Link>
                )}
                {row.actionType === "feedback" && (
                  <Link href={`/projects/${row.project.id}`} className="batch-action yellow">
                    View Feedback
                  </Link>
                )}
                {row.actionType === "retry" && (
                  <button type="button" className="batch-action red" onClick={() => fetchProgress()}>
                    Retry
                  </button>
                )}
                {row.actionType === "tasks" && (
                  <Link href={`/projects/${row.project.id}`} className="batch-action">
                    Tasks
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Night Shift card */}
      <div className="batch-night">
        <div className="batch-night-icon">{"\uD83C\uDF19"}</div>
        <div className="batch-night-content">
          <div className="batch-night-title">Night Shift Active</div>
          <div className="batch-night-text">
            Your CEO agent is working through the queue. Check back in the morning &mdash; your &ldquo;While You Were Away&rdquo;
            summary will have all results. Projects in &ldquo;Refining&rdquo; state are re-running the phase with your feedback
            incorporated.
          </div>
        </div>
      </div>
    </div>
  );
}
