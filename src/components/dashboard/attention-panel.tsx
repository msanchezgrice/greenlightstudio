import Link from "next/link";
import { getAgentProfile, humanizeTaskDescription } from "@/lib/phases";

type AttentionItem = {
  type: "failed" | "pending" | "low_confidence";
  project_id: string;
  project_name: string;
  description: string;
  agent: string;
  time_ago: string;
  confidence?: number | null;
};

export function AttentionPanel({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <div className="dash-col-card">
        <div className="dash-col-header">
          <h3 className="dash-col-title">
            <span style={{ color: "var(--green)" }}>●</span>
            Needs Attention
          </h3>
        </div>
        <div className="dash-all-clear">
          <div className="dash-all-clear-icon">✓</div>
          <div>Nothing needs your attention. Portfolio is healthy.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="dash-col-card">
      <div className="dash-col-header">
        <h3 className="dash-col-title">
          <span style={{ color: "var(--yellow)" }}>◆</span>
          Needs Attention
        </h3>
        <span className="dash-col-count warn">{items.length}</span>
      </div>
      <div className="dash-attention-list">
        {items.map((item, i) => {
          const profile = getAgentProfile(item.agent);
          const icon = item.type === "failed" ? "✕" : "⏳";
          const iconBg = item.type === "failed" ? "rgba(239,68,68,.1)" : "rgba(234,179,8,.1)";
          const iconColor = item.type === "failed" ? "var(--red)" : "var(--yellow)";
          const ctaLabel = item.type === "failed" ? "Retry" : "Review";
          const ctaHref = item.type === "pending" ? "/inbox" : `/projects/${item.project_id}`;
          const isPrimary = item.type === "failed";

          return (
            <div key={`${item.project_id}-${item.type}-${i}`} className="dash-attention-item">
              <div className="dash-attention-icon" style={{ background: iconBg }}>
                <span style={{ color: iconColor }}>{icon}</span>
              </div>
              <div className="dash-attention-body">
                <div className="dash-attention-title">{item.project_name} — {item.description}</div>
                <div className="dash-attention-meta">
                  <span className="dash-attention-agent" style={{ color: profile.color }}>
                    {profile.icon} {profile.name}
                  </span>
                  <span>·</span>
                  <span>{item.time_ago}</span>
                </div>
              </div>
              <Link href={ctaHref} className={`dash-attention-cta${isPrimary ? " primary" : ""}`}>
                {ctaLabel}
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
