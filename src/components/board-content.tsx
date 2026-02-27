"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { humanizeTaskDescription, getAgentProfile } from "@/lib/phases";
import { AgentActivityIndicator } from "@/components/agent-activity";

export type RunningAgent = {
  projectId: string;
  projectName: string;
  agent: string;
  description: string;
};

/* ---------- AnimatedNumber ---------- */

export function AnimatedNumber({ value, duration = 800 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(value);
  const prevValue = useRef(value);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const from = prevValue.current;
    prevValue.current = value;

    if (from === value) return;

    const start = performance.now();
    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (progress < 1) raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [value, duration]);

  return <>{display}</>;
}

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
  live_url: string | null;
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
    const failLabel = p.latest_task_desc ? humanizeTaskDescription(p.latest_task_desc) : "Agent failed";
    return { pct: 20, label: failLabel, gradient: "linear-gradient(90deg,#EF4444,#DC2626)" };
  }

  const isRunning = !!p.running_agent;
  const base = p.phase * 25;

  if (p.phase >= 3) {
    const pct = isRunning ? 30 : 100;
    const label = isRunning ? humanizeTaskDescription(p.running_desc ?? "Running") : "Complete";
    return { pct, label, gradient: "linear-gradient(90deg,#EAB308,#CA8A04)" };
  }

  if (isRunning) {
    const pct = base + 15;
    const label = humanizeTaskDescription(p.running_desc ?? "Running");
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

function NowBanner({ agents }: { agents: RunningAgent[] }) {
  const prevIds = useRef<Set<string>>(new Set());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const currentIds = new Set(agents.map((a) => a.projectId));
    const fresh = new Set<string>();
    for (const id of currentIds) {
      if (!prevIds.current.has(id)) fresh.add(id);
    }
    prevIds.current = currentIds;
    if (fresh.size > 0) {
      setNewIds(fresh);
      const timer = setTimeout(() => setNewIds(new Set()), 600);
      return () => clearTimeout(timer);
    }
  }, [agents]);

  if (!agents.length) return null;
  return (
    <div className="now-banner">
      <span className="now-label">● Now</span>
      <div className="now-divider" />
      {agents.map((a) => {
        const profile = getAgentProfile(a.agent);
        const isNew = newIds.has(a.projectId);
        return (
          <div
            key={a.projectId}
            className="now-agent"
            style={isNew ? { animation: "fadeInUp 0.5s ease both" } : undefined}
          >
            <div
              className="now-agent-icon"
              style={{ background: `${profile.color}18`, color: profile.color }}
            >
              {profile.icon}
            </div>
            <div>
              <div className="now-agent-name">
                {profile.name}
                <span className="live-dot active" style={{ background: profile.color }} />
              </div>
              <div className="now-agent-project">{a.projectName}</div>
              <div className="now-agent-status">{humanizeTaskDescription(a.description)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function BoardContent({
  projects,
  packetCount: _packetCount,
  runningAgents = [],
}: {
  projects: ProjectRow[];
  packetCount: number;
  runningAgents?: RunningAgent[];
}) {
  const [filter, setFilter] = useState<FilterPhase>("all");
  const [sort, setSort] = useState<SortMode>("updated");
  const [retrying, setRetrying] = useState<Set<string>>(new Set());

  // --- New/changed row detection ---
  const prevProjects = useRef<Map<string, string>>(new Map());
  const [newRowIds, setNewRowIds] = useState<Set<string>>(new Set());
  const [changedRowIds, setChangedRowIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fresh = new Set<string>();
    const changed = new Set<string>();
    for (const p of projects) {
      const fingerprint = `${p.phase}|${p.running_agent}|${p.latest_task_status}|${p.confidence}`;
      const prev = prevProjects.current.get(p.id);
      if (prev === undefined) {
        fresh.add(p.id);
      } else if (prev !== fingerprint) {
        changed.add(p.id);
      }
      prevProjects.current.set(p.id, fingerprint);
    }
    if (fresh.size > 0) {
      setNewRowIds(fresh);
      const t = setTimeout(() => setNewRowIds(new Set()), 800);
      return () => clearTimeout(t);
    }
    if (changed.size > 0) {
      setChangedRowIds(changed);
      const t = setTimeout(() => setChangedRowIds(new Set()), 1200);
      return () => clearTimeout(t);
    }
  }, [projects]);

  const retryLaunch = useCallback(async (projectId: string) => {
    setRetrying((prev) => new Set(prev).add(projectId));
    try {
      const res = await fetch(`/api/projects/${projectId}/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceNewApproval: true }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        const msg = (json as Record<string, unknown> | null)?.error;
        alert(typeof msg === "string" ? msg : `Retry failed (HTTP ${res.status})`);
      } else {
        const json = await res.json().catch(() => null) as Record<string, unknown> | null;
        if (json?.alreadyRunning) {
          alert("A launch is already in progress for this project.");
        } else {
          window.location.reload();
        }
      }
    } catch {
      alert("Network error — please try again.");
    } finally {
      setRetrying((prev) => { const next = new Set(prev); next.delete(projectId); return next; });
    }
  }, []);

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
      <NowBanner agents={runningAgents} />
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

      <div className="table-shell board-animated" style={{ marginBottom: 28 }}>
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
              const isNew = newRowIds.has(p.id);
              const isChanged = changedRowIds.has(p.id);

              return (
                <tr
                  key={p.id}
                  style={isNew ? { animation: "fadeInUp 0.5s ease both" } : isChanged ? { animation: "statFlashGreen 1s ease" } : undefined}
                >
                  {/* Project */}
                  <td>
                    <Link
                      href={`/projects/${p.id}`}
                      style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit" }}
                    >
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
                    </Link>
                  </td>

                  {/* Phase badge */}
                  <td>
                    <span
                      className="board-phase-badge"
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
                        {p.confidence !== null ? <AnimatedNumber value={p.confidence} /> : "--"}
                      </span>
                    </div>
                  </td>

                  {/* Status */}
                  <td>
                    {p.running_agent ? (
                      <AgentActivityIndicator
                        agentKey={p.running_agent}
                        taskDescription={p.running_desc ? humanizeTaskDescription(p.running_desc) : null}
                      />
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                        <div className={`board-status-dot ${status.className}`} />
                        <span style={status.className === "failed" ? { color: "var(--red)" } : undefined}>
                          {status.label}
                        </span>
                      </div>
                    )}
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
                      {p.latest_task_status === "failed" && p.confidence === null && (
                        <button
                          className="board-action"
                          style={{ color: "var(--green)", borderColor: "var(--green)" }}
                          disabled={retrying.has(p.id)}
                          onClick={() => retryLaunch(p.id)}
                        >
                          {retrying.has(p.id) ? "Retrying…" : "Retry"}
                        </button>
                      )}
                      {p.confidence !== null && (
                        <Link href={`/projects/${p.id}/packet`} className="board-action">
                          Packet
                        </Link>
                      )}
                      {p.live_url && (
                        <a href={p.live_url} target="_blank" rel="noopener noreferrer" className="board-action">
                          Landing
                        </a>
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
