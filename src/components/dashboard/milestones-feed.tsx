import Link from "next/link";
import { getAgentProfile, humanizeTaskDescription, taskPhase } from "@/lib/phases";

type MilestoneItem = {
  project_name: string;
  project_id: string;
  agent: string;
  description: string;
  detail: string | null;
  created_at: string;
  confidence?: number | null;
};

const PHASE_COLORS: Record<number, string> = {
  0: "#22C55E",
  1: "#3B82F6",
  2: "#A855F7",
  3: "#EAB308",
};

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

export function MilestonesFeed({ items }: { items: MilestoneItem[] }) {
  if (items.length === 0) {
    return (
      <div className="dash-col-card">
        <div className="dash-col-header">
          <h3 className="dash-col-title">
            <span style={{ color: "var(--green)" }}>●</span>
            Recent Milestones
          </h3>
        </div>
        <div className="dash-all-clear">
          <div>No milestones yet. Projects are still cooking.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="dash-col-card">
      <div className="dash-col-header">
        <h3 className="dash-col-title">
          <span style={{ color: "var(--green)" }}>●</span>
          Recent Milestones
        </h3>
        <span className="dash-col-count good">This week</span>
      </div>
      <div className="dash-milestone-list">
        {items.map((item, i) => {
          const profile = getAgentProfile(item.agent);
          const phase = taskPhase(item.description);
          const dotColor = phase !== null ? (PHASE_COLORS[phase] ?? "var(--green)") : "var(--green)";
          const phaseLabel = phase !== null ? `Phase ${phase}` : null;

          return (
            <div key={`${item.project_id}-${item.description}-${i}`} className="dash-milestone-item">
              <div className="dash-milestone-line">
                <div className="dash-milestone-dot" style={{ background: dotColor }} />
                {i < items.length - 1 && <div className="dash-milestone-stem" />}
              </div>
              <div className="dash-milestone-body">
                <Link
                  href={`/projects/${item.project_id}`}
                  className="dash-milestone-title"
                >
                  {item.project_name} — {humanizeTaskDescription(item.description)}
                </Link>
                {item.detail && (
                  <div className="dash-milestone-detail">{item.detail}</div>
                )}
                <div className="dash-milestone-footer">
                  {phaseLabel && (
                    <span className="dash-milestone-badge" style={{ background: `${dotColor}18`, color: dotColor }}>
                      {phaseLabel}
                    </span>
                  )}
                  <span style={{ color: profile.color, fontWeight: 600 }}>
                    {profile.icon} {profile.name}
                  </span>
                  <span>·</span>
                  <span>{relativeTime(item.created_at)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
