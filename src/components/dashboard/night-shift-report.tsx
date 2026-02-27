"use client";

import { useState } from "react";
import { getAgentProfile, humanizeTaskDescription } from "@/lib/phases";

type NightShiftItem = {
  project_name: string;
  project_id: string;
  agent: string;
  description: string;
  detail: string | null;
};

export function NightShiftReport({
  items,
  projectNames,
}: {
  items: NightShiftItem[];
  projectNames: Map<string, string>;
}) {
  const [open, setOpen] = useState(true);

  if (items.length === 0) return null;

  const byProject = new Map<string, NightShiftItem[]>();
  for (const item of items) {
    const list = byProject.get(item.project_id) ?? [];
    list.push(item);
    byProject.set(item.project_id, list);
  }

  const projectCount = byProject.size;

  return (
    <section className={`dash-nightshift${open ? " open" : ""}`}>
      <button className="dash-nightshift-header" onClick={() => setOpen(!open)} type="button">
        <div className="dash-nightshift-title">
          <span className="dash-nightshift-moon">🌙</span>
          While you were away
          <span className="dash-nightshift-count">
            {items.length} action{items.length !== 1 ? "s" : ""} across {projectCount} project{projectCount !== 1 ? "s" : ""}
          </span>
        </div>
        <span className="dash-nightshift-chevron">▾</span>
      </button>
      {open && (
        <div className="dash-nightshift-body">
          {[...byProject.entries()].map(([projectId, tasks]) => (
            <div key={projectId} className="dash-nightshift-card">
              <div className="dash-nightshift-card-title">
                {projectNames.get(projectId) ?? projectId}
              </div>
              <div className="dash-nightshift-card-detail">
                {tasks.map((t) => humanizeTaskDescription(t.description)).join(". ")}.
              </div>
              <div className="dash-nightshift-card-agents">
                {[...new Set(tasks.map((t) => t.agent))].map((agentKey) => {
                  const profile = getAgentProfile(agentKey);
                  return (
                    <span key={agentKey} className="dash-nightshift-agent-chip" style={{ background: `${profile.color}18`, color: profile.color }}>
                      {profile.icon} {profile.name}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
