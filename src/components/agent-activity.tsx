"use client";

import { useEffect, useState } from "react";
import { AGENT_PROFILES } from "@/lib/phases";

const PHRASES = Object.values(AGENT_PROFILES).map((a) => ({
  icon: a.icon,
  name: a.name,
  phrase: a.statusPhrase,
  color: a.color,
}));

function AgentActivityIndicator({
  agentKey,
  taskDescription,
  compact,
}: {
  agentKey?: string | null;
  taskDescription?: string | null;
  compact?: boolean;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % PHRASES.length), 2800);
    return () => clearInterval(id);
  }, []);

  const matched = agentKey ? AGENT_PROFILES[agentKey] : null;
  const current = matched
    ? { icon: matched.icon, name: matched.name, phrase: matched.statusPhrase, color: matched.color }
    : PHRASES[index];

  const tooltip = [
    matched ? `${matched.icon} ${matched.name}` : null,
    taskDescription ?? null,
    matched ? matched.statusPhrase : null,
  ]
    .filter(Boolean)
    .join("\n");

  if (compact) {
    return (
      <span
        className="agent-activity-compact"
        title={tooltip}
        style={{ color: current.color }}
      >
        <span className="agent-activity-dot" style={{ background: current.color }} />
        <span className="agent-activity-text">{current.phrase}</span>
      </span>
    );
  }

  return (
    <div className="agent-activity" title={tooltip}>
      <span className="agent-activity-dot" style={{ background: current.color }} />
      <span className="agent-activity-icon">{current.icon}</span>
      <span className="agent-activity-text" style={{ color: current.color }}>
        {current.phrase}
      </span>
    </div>
  );
}

function AgentActivityCarousel({ agents }: { agents: Array<{ key: string; description: string | null }> }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (agents.length <= 1) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % agents.length), 3200);
    return () => clearInterval(id);
  }, [agents.length]);

  if (!agents.length) return null;

  const current = agents[index % agents.length];
  const profile = AGENT_PROFILES[current.key] ?? { icon: "🤖", name: current.key, color: "#94A3B8", statusPhrase: "Working…" };

  return (
    <div className="agent-activity" title={`${profile.icon} ${profile.name}: ${current.description ?? profile.statusPhrase}`}>
      <span className="agent-activity-dot" style={{ background: profile.color }} />
      <span className="agent-activity-icon">{profile.icon}</span>
      <span className="agent-activity-text" style={{ color: profile.color }}>
        {profile.statusPhrase}
      </span>
    </div>
  );
}

export { AgentActivityIndicator, AgentActivityCarousel };
