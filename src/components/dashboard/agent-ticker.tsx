"use client";

import { getAgentProfile, humanizeTaskDescription } from "@/lib/phases";

type TickerItem = {
  project_id: string;
  project_name: string;
  agent: string;
  description: string;
  completed?: boolean;
  time_ago?: string;
};

export function AgentTicker({ items }: { items: TickerItem[] }) {
  if (items.length === 0) {
    return (
      <div className="dash-ticker-wrap">
        <div className="dash-ticker-label">
          <span className="dash-ticker-label-dot idle" />
          IDLE
        </div>
        <div className="dash-ticker-idle">All agents idle. Portfolio at rest.</div>
      </div>
    );
  }

  const doubled = [...items, ...items];

  return (
    <div className="dash-ticker-wrap">
      <div className="dash-ticker-label">
        <span className="dash-ticker-label-dot" />
        LIVE
      </div>
      <div className="dash-ticker-track">
        {doubled.map((item, i) => {
          const profile = getAgentProfile(item.agent);
          return (
            <span key={`${item.project_id}-${item.agent}-${i}`} className="dash-ticker-item">
              <span className="dash-ticker-agent" style={{ color: profile.color }}>
                {profile.icon} {profile.name}
              </span>
              <span className="dash-ticker-arrow">→</span>
              <span>{humanizeTaskDescription(item.description)}</span>
              <span className="dash-ticker-arrow">for</span>
              <span className="dash-ticker-project">{item.project_name}</span>
              {item.completed && item.time_ago && (
                <span style={{ color: "var(--green)", fontSize: 11, fontWeight: 600 }}>
                  ✓ {item.time_ago}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
