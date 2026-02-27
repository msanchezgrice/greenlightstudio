import Link from "next/link";
import { PHASES, getAgentProfile, humanizeTaskDescription } from "@/lib/phases";

type PipelineProject = {
  id: string;
  name: string;
  phase: number;
  confidence: number | null;
  running_agent: string | null;
  running_desc: string | null;
  latest_task_status: string | null;
};

function confidenceColor(c: number | null) {
  if (c === null) return "var(--text3)";
  if (c >= 70) return "#22C55E";
  if (c >= 50) return "#EAB308";
  return "#EF4444";
}

const PHASE_COLORS: Record<number, { color: string; bg: string }> = {
  0: { color: "#22C55E", bg: "rgba(34,197,94,.12)" },
  1: { color: "#3B82F6", bg: "rgba(59,130,246,.12)" },
  2: { color: "#A855F7", bg: "rgba(168,85,247,.12)" },
  3: { color: "#EAB308", bg: "rgba(234,179,8,.12)" },
};

export function PhasePipeline({ projects }: { projects: PipelineProject[] }) {
  const byPhase = new Map<number, PipelineProject[]>();
  for (const p of projects) {
    const list = byPhase.get(p.phase) ?? [];
    list.push(p);
    byPhase.set(p.phase, list);
  }

  return (
    <section className="dash-pipeline-section">
      <div className="dash-section-header">
        <h2 className="dash-section-title">Phase Pipeline</h2>
        <span className="dash-section-subtitle">Project distribution across phases</span>
      </div>
      <div className="dash-pipeline">
        {PHASES.map((phase) => {
          const pc = PHASE_COLORS[phase.id] ?? PHASE_COLORS[0];
          const phaseProjects = byPhase.get(phase.id) ?? [];
          return (
            <div key={phase.id} className="dash-pipeline-lane">
              <div className="dash-pipeline-phase" style={{ borderLeft: `3px solid ${pc.color}` }}>
                <span className="dash-pipeline-phase-num" style={{ background: pc.bg, color: pc.color }}>
                  P{phase.id}
                </span>
                <span className="dash-pipeline-phase-title">{phase.title}</span>
              </div>
              <div className="dash-pipeline-projects">
                {phaseProjects.length === 0 ? (
                  <span className="dash-pipeline-empty">No projects in this phase</span>
                ) : (
                  phaseProjects.map((p) => {
                    const isRunning = !!p.running_agent;
                    const isFailed = p.latest_task_status === "failed";
                    const agent = p.running_agent ? getAgentProfile(p.running_agent) : null;
                    return (
                      <Link
                        key={p.id}
                        href={`/projects/${p.id}`}
                        className={`dash-pipeline-chip${isRunning ? " running" : ""}${isFailed ? " failed" : ""}`}
                      >
                        <span
                          className={`dash-chip-status${isRunning ? " running" : ""}`}
                          style={{ background: isFailed ? "var(--red)" : isRunning ? "var(--green)" : "var(--text3)" }}
                        />
                        {p.name}
                        <span className="dash-chip-confidence" style={{ background: confidenceColor(p.confidence) }} />
                        {agent && <span className="dash-chip-agent">{agent.icon}</span>}
                      </Link>
                    );
                  })
                )}
              </div>
              <div className="dash-pipeline-count" style={phaseProjects.length === 0 ? { opacity: 0.4 } : undefined}>
                {phaseProjects.length}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
