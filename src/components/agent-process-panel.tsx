"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { AGENT_PROFILES } from "@/lib/phases";

type LiveTask = {
  id: string;
  description: string;
  detail: string | null;
  created_at: string;
};

type RunningAgent = {
  agent: string;
  started_at: string;
  tasks: LiveTask[];
};

type TraceRow = {
  agent: string;
  detail: string | null;
  created_at: string;
};

type LivePayload = {
  running_agents: RunningAgent[];
  recent_completions: Array<{
    id: string;
    agent: string;
    description: string;
    status: string;
    detail: string | null;
    created_at: string;
  }>;
  traces: TraceRow[];
  polled_at: string;
};

function ElapsedTimer({ since }: { since: string }) {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    const start = new Date(since).getTime();
    function tick() {
      const diff = Math.max(0, Date.now() - start);
      const s = Math.floor(diff / 1000) % 60;
      const m = Math.floor(diff / 60000);
      setElapsed(`${m}:${String(s).padStart(2, "0")}`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [since]);

  return (
    <span className="elapsed-timer">
      <span className="elapsed-dot" />
      {elapsed}
    </span>
  );
}

function parseTraceDetails(detail: string | null): string[] {
  if (!detail) return [];
  try {
    const parsed = JSON.parse(detail);
    if (Array.isArray(parsed)) {
      return parsed.map((t: { tool?: string; input_preview?: string }) =>
        `${t.tool ?? "tool"}${t.input_preview ? `: ${t.input_preview}` : ""}`,
      );
    }
  } catch {
    /* not JSON, use raw */
  }
  return detail.split("||").map((s) => s.trim()).filter(Boolean);
}

export function AgentProcessPanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<LivePayload | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const prevRunningRef = useRef<string[]>([]);
  const [completedFlash, setCompletedFlash] = useState<Set<string>>(new Set());

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/agents/live`, { cache: "no-store" });
      if (res.ok) {
        const payload: LivePayload = await res.json();
        setData(payload);

        const currentRunning = payload.running_agents.map((a) => a.agent);
        const justFinished = prevRunningRef.current.filter((a) => !currentRunning.includes(a));
        if (justFinished.length > 0) {
          setCompletedFlash(new Set(justFinished));
          setTimeout(() => setCompletedFlash(new Set()), 2000);
        }
        prevRunningRef.current = currentRunning;
      }
    } catch {
      /* network error, skip */
    }
  }, [projectId]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 4000);
    return () => clearInterval(id);
  }, [poll]);

  if (!data) return null;

  const { running_agents, recent_completions, traces } = data;
  const hasActivity = running_agents.length > 0;

  if (!hasActivity && recent_completions.length === 0) return null;

  return (
    <section className="studio-card agent-live-section">
      <h2>
        Agent Processes
        {hasActivity && (
          <span className="agent-live-badge">
            <span className="agent-activity-dot" style={{ background: "var(--green)", width: 6, height: 6 }} />
            {running_agents.length} active
          </span>
        )}
      </h2>

      {hasActivity && (
        <div className={`agent-live-grid agents-${Math.min(running_agents.length, 4)}`}>
          {running_agents.map((ra) => {
            const profile = AGENT_PROFILES[ra.agent] ?? { icon: "🤖", name: ra.agent, color: "#94A3B8", statusPhrase: "Working…" };
            const isExpanded = expanded === ra.agent;
            const taskDetails = ra.tasks.map((t) => parseTraceDetails(t.detail)).flat();
            const agentTraces = traces.filter((t) => t.agent === ra.agent).flatMap((t) => parseTraceDetails(t.detail));
            const allTraces = [...taskDetails, ...agentTraces].filter(Boolean);

            return (
              <div
                key={ra.agent}
                className={`agent-live-tile ${isExpanded ? "expanded" : ""}`}
                style={{ borderColor: `${profile.color}33` }}
                onClick={() => setExpanded(isExpanded ? null : ra.agent)}
              >
                <div className="agent-live-tile-header">
                  <div className="agent-panel-icon" style={{ background: `${profile.color}18`, color: profile.color }}>
                    <span className="ring" style={{ borderColor: profile.color }} />
                    {profile.icon}
                  </div>
                  <div className="agent-live-tile-info">
                    <div className="agent-panel-name" style={{ color: profile.color }}>{profile.name}</div>
                    <div className="agent-panel-status" style={{ color: "var(--green)" }}>
                      {profile.statusPhrase}
                    </div>
                  </div>
                  <ElapsedTimer since={ra.started_at} />
                </div>

                <div className="shimmer-progress">
                  <div className="shimmer-fill" style={{ width: "60%", background: `linear-gradient(90deg, ${profile.color}66, ${profile.color})` }} />
                </div>

                {ra.tasks.length > 0 && (
                  <div className="agent-live-tasks">
                    {ra.tasks.map((t) => (
                      <div key={t.id} className="agent-live-task-row">
                        <span className="board-status-dot running" style={{ background: profile.color }} />
                        <span className="agent-live-task-desc">{humanize(t.description)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {isExpanded && allTraces.length > 0 && (
                  <div className="agent-live-trace-log">
                    {allTraces.slice(0, 12).map((trace, i) => (
                      <div key={i} className="agent-live-trace-entry">
                        <span className="agent-live-trace-marker">▸</span>
                        <span className="agent-live-trace-text">{trace}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!hasActivity && recent_completions.length > 0 && (
        <div className="agent-live-recent">
          {recent_completions.slice(0, 4).map((c) => {
            const profile = AGENT_PROFILES[c.agent] ?? { icon: "🤖", name: c.agent, color: "#94A3B8", statusPhrase: "Done" };
            const flash = completedFlash.has(c.agent);
            return (
              <div key={c.id} className={`agent-live-done-chip ${flash ? "flash" : ""}`}>
                <span className="check-pop">✓</span>
                <span style={{ color: profile.color, fontWeight: 600 }}>{profile.icon} {profile.name}</span>
                <span className="agent-live-done-desc">{humanize(c.description)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function humanize(desc: string): string {
  const labels: Record<string, string> = {
    phase0_init: "Initializing project",
    phase0_research: "Researching market & competitors",
    phase0_research_query: "Running research queries",
    phase0_packet: "Building pitch packet",
    phase1_init: "Initializing Phase 1",
    phase1_validate: "Generating validation assets",
    phase1_landing: "Building landing page",
    phase1_brand: "Creating brand kit",
  };
  return labels[desc] ?? desc.replace(/^phase\d+_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
