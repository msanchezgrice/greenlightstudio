"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { RetryTaskButton } from "@/components/retry-task-button";
import { getAgentProfile, humanizeTaskDescription, taskOutputLink } from "@/lib/phases";

type TaskRow = {
  id: string;
  project_id: string;
  agent: string;
  description: string;
  status: "queued" | "running" | "completed" | "failed";
  detail: string | null;
  created_at: string;
};

type TaskLogRow = {
  id: string;
  project_id: string;
  step: string;
  status: string;
  detail: string | null;
  created_at: string;
};

function statusClass(status: string) {
  if (status === "completed") return "good";
  if (status === "failed") return "bad";
  if (status === "running" || status === "queued") return "warn";
  return "tone-muted";
}

const FEED_BATCH_SIZE = 5;
const FEED_INTERVAL_MS = 120;

export function AnimatedTaskQueue({
  tasks,
  logRows,
  projectNameMap,
}: {
  tasks: TaskRow[];
  logRows: TaskLogRow[];
  projectNameMap: Record<string, string>;
}) {
  const [visibleCount, setVisibleCount] = useState(0);
  const [completedFlash, setCompletedFlash] = useState<Set<string>>(new Set());
  const prevStatuses = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (tasks.length === 0) return;
    let count = 0;
    const timer = setInterval(() => {
      count += FEED_BATCH_SIZE;
      setVisibleCount(Math.min(count, tasks.length));
      if (count >= tasks.length) clearInterval(timer);
    }, FEED_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [tasks.length]);

  useEffect(() => {
    const flash = new Set<string>();
    for (const task of tasks) {
      const prev = prevStatuses.current.get(task.id);
      if (prev && prev !== "completed" && task.status === "completed") {
        flash.add(task.id);
      }
      prevStatuses.current.set(task.id, task.status);
    }
    if (flash.size > 0) {
      setCompletedFlash(flash);
      const timeout = setTimeout(() => setCompletedFlash(new Set()), 2000);
      return () => clearTimeout(timeout);
    }
  }, [tasks]);

  const visibleTasks = tasks.slice(0, visibleCount);

  return (
    <>
      <section className="studio-card">
        <h2>Task Queue</h2>
        {!tasks.length ? (
          <p className="meta-line">No tasks recorded yet.</p>
        ) : (
          <div className="table-shell">
            <table className="studio-table compact">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Agent</th>
                  <th>Task</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleTasks.map((task, i) => {
                  const agent = getAgentProfile(task.agent);
                  const output = taskOutputLink(task.description, task.project_id);
                  const isRunning = task.status === "running";
                  const justCompleted = completedFlash.has(task.id);

                  return (
                    <tr
                      key={task.id}
                      className={justCompleted ? "task-row-completed-glow" : isRunning ? "task-row-running" : ""}
                      style={{
                        animation: `fadeInUp 0.35s ease ${i * 0.04}s both`,
                      }}
                    >
                      <td>
                        <Link href={`/projects/${task.project_id}`} style={{ color: "var(--heading)", fontWeight: 500, textDecoration: "none" }}>
                          {projectNameMap[task.project_id] ?? task.project_id}
                        </Link>
                      </td>
                      <td>
                        <span style={{ color: agent.color, fontWeight: 600 }}>
                          {agent.icon} {agent.name}
                        </span>
                      </td>
                      <td>
                        <div className="table-main">{humanizeTaskDescription(task.description)}</div>
                        <div className="table-sub">{task.detail ?? ""}</div>
                      </td>
                      <td>
                        <span className={`task-status-badge ${task.status}`}>
                          {isRunning && <span className="task-running-dot" />}
                          {task.status}
                        </span>
                      </td>
                      <td>{new Date(task.created_at).toLocaleString()}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {task.status === "failed" && (
                          <RetryTaskButton projectId={task.project_id} />
                        )}
                        {task.status === "completed" && output && (
                          <Link href={output.href} className="btn btn-details btn-sm">
                            {output.label}
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="studio-card">
        <h2>Task Log</h2>
        {!logRows.length ? (
          <p className="meta-line">No task log entries yet.</p>
        ) : (
          <div className="table-shell">
            <table className="studio-table compact">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Step</th>
                  <th>Status</th>
                  <th>Detail</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {logRows.map((entry) => (
                  <tr key={entry.id}>
                    <td>{projectNameMap[entry.project_id] ?? entry.project_id}</td>
                    <td>{humanizeTaskDescription(entry.step)}</td>
                    <td className={statusClass(entry.status)}>{entry.status}</td>
                    <td>{entry.detail ?? ""}</td>
                    <td>{new Date(entry.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
