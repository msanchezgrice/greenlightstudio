import { getAgentProfile, humanizeTaskDescription } from "@/lib/phases";

type ActivityItem = {
  project_name: string;
  project_id: string;
  agent: string;
  description: string;
  status: string;
  detail: string | null;
  created_at: string;
};

function statusEmoji(status: string) {
  if (status === "completed") return "✅";
  if (status === "failed") return "❌";
  if (status === "running") return "⚡";
  return "⏳";
}

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

export function RecentActivity({ items }: { items: ActivityItem[] }) {
  if (!items.length) return null;

  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "36px 0 16px" }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--heading)", margin: 0 }}>Recent Activity</h2>
      </div>
      <div className="activity-grid">
        {items.map((item, i) => {
          const agent = getAgentProfile(item.agent);
          return (
            <div key={i} className="activity-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 8 }}>
                <span className="activity-title" style={{ fontSize: 12, fontWeight: 600 }}>
                  {item.project_name}
                </span>
                <span className="activity-time">{relativeTime(item.created_at)}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, color: "var(--heading)" }}>
                {humanizeTaskDescription(item.description)}
              </div>
              {item.detail && (
                <div style={{ fontSize: 11, color: "var(--text2)", lineHeight: 1.4 }}>
                  {item.detail}
                </div>
              )}
              <div className="activity-icon">
                <span className="activity-icon">{statusEmoji(item.status)}</span>{" "}
                <span style={{ color: agent.color }}>{agent.icon} {agent.name}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
