"use client";

import { useState, useMemo } from "react";
import Link from "next/link";

export type ProjectRow = {
  id: string;
  name: string;
  domain: string | null;
  phase: number;
  night_shift: boolean;
  confidence: number | null;
  packet_phase: number | null;
  pending: number;
  running_agent: string | null;
  running_desc: string | null;
  latest_task_status: string | null;
  latest_task_desc: string | null;
};

type FilterPhase = "all" | "0" | "1" | "2" | "3" | "failed";
type SortMode = "updated" | "name" | "confidence";

const phaseColors: Record<number, { bg: string; color: string; label: string }> = {
  0: { bg: "rgba(34,197,94,.12)", color: "#22C55E", label: "Phase 0" },
  1: { bg: "rgba(59,130,246,.12)", color: "#3B82F6", label: "Phase 1" },
  2: { bg: "rgba(168,85,247,.12)", color: "#A855F7", label: "Phase 2" },
  3: { bg: "rgba(234,179,8,.12)", color: "#EAB308", label: "Phase 3" },
};

function progressForProject(p: ProjectRow): { pct: number; label: string; gradient: string } {
  const isFailed = p.latest_task_status === "failed";
  if (isFailed) {
    return { pct: 20, label: "Agent failed", gradient: "linear-gradient(90deg,#EF4444,#DC2626)" };
  }

  const isRunning = !!p.running_agent;
  const base = p.phase * 25;

  if (p.phase >= 3) {
    const pct = isRunning ? 30 : 100;
    const label = isRunning ? `${p.running_desc ?? "Running"}` : "Complete";
    return { pct, label, gradient: "linear-gradient(90deg,#EAB308,#CA8A04)" };
  }

  if (isRunning) {
    const pct = base + 15;
    const label = p.running_desc ?? "Running";
    return { pct, label, gradient: phaseGradient(p.phase) };
  }

  // Idle with packet ready
  if (p.confidence !== null) {
    const pct = Math.min(base + 25, 100);
    const label = "Packet ready";
    return { pct, label, gradient: phaseGradient(p.phase) };
  }

  const pct = Math.max(base, 5);
  const label = p.pending > 0 ? `${p.pending} pending` : "Idle";
  return { pct, label, gradient: phaseGradient(p.phase) };
}

function phaseGradient(phase: number) {
  switch (phase) {
    case 0:
      return "linear-gradient(90deg,#22C55E,#16A34A)";
    case 1:
      return "linear-gradient(90deg,#3B82F6,#2563EB)";
    case 2:
      return "linear-gradient(90deg,#A855F7,#8B5CF6)";
    case 3:
      return "linear-gradient(90deg,#EAB308,#CA8A04)";
    default:
      return "linear-gradient(90deg,#22C55E,#16A34A)";
  }
}

function statusInfo(p: ProjectRow): { label: string; className: string } {
  if (p.latest_task_status === "failed") return { label: "Failed", className: "failed" };
  if (p.running_agent) return { label: "Running", className: "running" };
  if (p.pending > 0) return { label: "Queued", className: "queued" };
  return { label: "Idle", className: "idle" };
}

function confidenceColor(c: number | null): string {
  if (c === null) return "var(--text3)";
  if (c >= 70) return "#22C55E";
  if (c >= 50) return "#EAB308";
  return "#EF4444";
}

export function BoardContent({
  projects,
  packetCount: _packetCount,
}: {
  projects: ProjectRow[];
  packetCount: number;
}) {
  const [filter, setFilter] = useState<FilterPhase>("all");
  const [sort, setSort] = useState<SortMode>("updated");

  const filtered = useMemo(() => {
    let list = [...projects];

    // Filter
    if (filter === "failed") {
      list = list.filter((p) => p.latest_task_status === "failed");
    } else if (filter !== "all") {
      list = list.filter((p) => p.phase === Number(filter));
    }

    // Sort
    if (sort === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === "confidence") {
      list.sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1));
    }
    // "updated" keeps the server order (most recently created/updated first)

    return list;
  }, [projects, filter, sort]);

  const filters: { key: FilterPhase; label: string }[] = [
    { key: "all", label: "All Phases" },
    { key: "0", label: "Phase 0" },
    { key: "1", label: "Phase 1" },
    { key: "2", label: "Phase 2" },
    { key: "3", label: "Phase 3" },
    { key: "failed", label: "Failed" },
  ];

  return (
    <>
      <div className="board-filter-bar">
        <div style={{ display: "flex", gap: 6 }}>
          {filters.map((f) => (
            <button
              key={f.key}
              className={`board-filter-btn${filter === f.key ? " active" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          className="board-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMode)}
        >
          <option value="updated">Sort: Last Updated</option>
          <option value="name">Sort: Name A-Z</option>
          <option value="confidence">Sort: Confidence High-Low</option>
        </select>
      </div>

      <div className="table-shell" style={{ marginBottom: 28 }}>
        <table className="studio-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Phase</th>
              <th>Progress</th>
              <th>Confidence</th>
              <th>Status</th>
              <th>Night</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: 24, color: "var(--text3)" }}>
                  No projects match this filter.
                </td>
              </tr>
            )}
            {filtered.map((p) => {
              const progress = progressForProject(p);
              const status = statusInfo(p);
              const phaseStyle = phaseColors[p.phase] ?? phaseColors[0];
              const confColor = confidenceColor(p.confidence);

              return (
                <tr key={p.id}>
                  {/* Project */}
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 8,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 15,
                          background: `linear-gradient(135deg, ${phaseStyle.color}20, ${phaseStyle.color}40)`,
                        }}
                      >
                        {p.phase >= 3 ? "💎" : p.phase >= 2 ? "🚀" : p.phase >= 1 ? "🪄" : "🏠"}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13, color: "var(--heading)" }}>
                          {p.name}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text3)" }}>
                          {p.domain ?? "No domain"}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Phase badge */}
                  <td>
                    <span
                      style={{
                        display: "inline-flex",
                        padding: "3px 9px",
                        borderRadius: 5,
                        fontSize: 11,
                        fontWeight: 600,
                        background: phaseStyle.bg,
                        color: phaseStyle.color,
                      }}
                    >
                      {phaseStyle.label}
                    </span>
                  </td>

                  {/* Progress */}
                  <td style={{ minWidth: 140 }}>
                    <div className="board-progress">
                      <div className="board-progress-bg">
                        <div
                          className="board-progress-fill"
                          style={{ width: `${progress.pct}%`, background: progress.gradient }}
                        />
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: p.latest_task_status === "failed" ? "var(--red)" : "var(--text3)",
                        }}
                      >
                        {progress.pct}% &middot; {progress.label}
                      </div>
                    </div>
                  </td>

                  {/* Confidence */}
                  <td>
                    <div className="board-confidence">
                      <div
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: confColor,
                        }}
                      />
                      <span style={{ fontSize: 13, fontWeight: 600, color: confColor }}>
                        {p.confidence ?? "--"}
                      </span>
                    </div>
                  </td>

                  {/* Status */}
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                      <div className={`board-status-dot ${status.className}`} />
                      <span style={status.className === "failed" ? { color: "var(--red)" } : undefined}>
                        {status.label}
                      </span>
                    </div>
                  </td>

                  {/* Night Shift */}
                  <td>
                    {p.night_shift ? (
                      <span className="board-night-badge on">🌙 On</span>
                    ) : (
                      <span className="board-night-badge off">Off</span>
                    )}
                  </td>

                  {/* Actions */}
                  <td>
                    <div style={{ display: "flex", gap: 5 }}>
                      <Link href={`/projects/${p.id}`} className="board-action primary">
                        Open
                      </Link>
                      {p.confidence !== null && (
                        <Link href={`/projects/${p.id}/packet`} className="board-action">
                          Packet
                        </Link>
                      )}
                      <Link href="/inbox" className="board-action">
                        Inbox
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
