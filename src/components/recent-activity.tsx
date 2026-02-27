"use client";

import { useEffect, useRef, useState } from "react";
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

function statusColor(status: string) {
  if (status === "completed") return "var(--green)";
  if (status === "failed") return "var(--red)";
  if (status === "running") return "var(--yellow)";
  return "var(--text3)";
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

function fingerprint(item: ActivityItem) {
  return `${item.project_id}|${item.description}|${item.created_at}`;
}

export function RecentActivity({ items }: { items: ActivityItem[] }) {
  const prevFingerprints = useRef<Set<string>>(new Set());
  const [freshSet, setFreshSet] = useState<Set<string>>(new Set());

  useEffect(() => {
    const currentFps = new Set(items.map(fingerprint));
    if (prevFingerprints.current.size > 0) {
      const fresh = new Set<string>();
      for (const fp of currentFps) {
        if (!prevFingerprints.current.has(fp)) fresh.add(fp);
      }
      if (fresh.size > 0) {
        setFreshSet(fresh);
        const t = setTimeout(() => setFreshSet(new Set()), 800);
        prevFingerprints.current = currentFps;
        return () => clearTimeout(t);
      }
    }
    prevFingerprints.current = currentFps;
  }, [items]);

  // Live-update relative times every 30s
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  if (!items.length) return null;

  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "36px 0 16px" }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--heading)", margin: 0, fontFamily: "var(--font-display)" }}>
          Recent Activity
        </h2>
      </div>
      <div className="timeline">
        {items.slice(0, 8).map((item, i) => {
          const agent = getAgentProfile(item.agent);
          const isFresh = freshSet.has(fingerprint(item));
          return (
            <div
              key={`${item.project_id}-${item.created_at}-${i}`}
              className="timeline-item"
              style={
                isFresh
                  ? { animation: "slideInDown 0.5s ease both" }
                  : { animation: `fadeInUp 0.4s ease ${i * 0.1}s both` }
              }
            >
              <div className="timeline-dot" style={{ color: statusColor(item.status), background: statusColor(item.status) }} />
              <div className="timeline-content">
                <div className="timeline-top">
                  <span className="timeline-project-name">{item.project_name}</span>
                  <span className="timeline-time">{relativeTime(item.created_at)}</span>
                </div>
                <div className="timeline-desc">{humanizeTaskDescription(item.description)}</div>
                {item.detail && (
                  <div style={{ fontSize: 11, color: "var(--text2)", lineHeight: 1.4, marginBottom: 4 }}>
                    {item.detail}
                  </div>
                )}
                <div className="timeline-agent" style={{ color: agent.color }}>
                  {agent.icon} {agent.name}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
