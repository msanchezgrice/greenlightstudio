"use client";

import { getAgentProfile } from "@/lib/phases";

type RunningAgent = {
  project_id: string;
  project_name: string;
  agent: string;
  description: string;
};

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function GreetingStrip({
  userName,
  projectCount,
  pendingCount,
  runningAgents,
}: {
  userName: string;
  projectCount: number;
  pendingCount: number;
  runningAgents: RunningAgent[];
}) {
  const activeCount = runningAgents.length;
  const uniqueAgents = [...new Map(runningAgents.map((r) => [r.agent, r])).values()];

  const subParts: string[] = [];
  if (activeCount > 0) {
    subParts.push(`${activeCount} agent${activeCount > 1 ? "s" : ""} active across ${projectCount} project${projectCount !== 1 ? "s" : ""}`);
  } else {
    subParts.push(`${projectCount} project${projectCount !== 1 ? "s" : ""} in your portfolio`);
  }
  if (pendingCount > 0) {
    subParts.push(`${pendingCount} approval${pendingCount !== 1 ? "s" : ""} need${pendingCount === 1 ? "s" : ""} your attention`);
  }

  return (
    <section className="dash-greeting">
      <h1 className="dash-greeting-headline">
        {timeGreeting()}, {userName}.
      </h1>
      <p className="dash-greeting-sub">
        <span>{subParts.join(". ")}.</span>
        {uniqueAgents.length > 0 && (
          <span className="dash-agent-presence">
            {uniqueAgents.map((r, i) => {
              const profile = getAgentProfile(r.agent);
              return (
                <span
                  key={r.agent}
                  className="dash-agent-dot"
                  style={{
                    background: profile.color,
                    color: profile.color,
                    animationDelay: `${i * 0.4}s`,
                  }}
                  title={`${profile.icon} ${profile.name} — ${profile.statusPhrase}`}
                />
              );
            })}
          </span>
        )}
      </p>
    </section>
  );
}
