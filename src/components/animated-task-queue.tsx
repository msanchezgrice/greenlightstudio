"use client";

import { Fragment, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { RetryTaskButton } from "@/components/retry-task-button";
import { getAgentProfile, humanizeTaskDescription, taskOutputLink, AGENT_PROFILES } from "@/lib/phases";

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

function ElapsedTimer({ createdAt }: { createdAt: string }) {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    function update() {
      const diff = Math.max(0, Date.now() - new Date(createdAt).getTime());
      const secs = Math.floor(diff / 1000);
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      setElapsed(`${m}:${String(s).padStart(2, "0")}`);
    }
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [createdAt]);

  return (
    <span className="elapsed-timer">
      <span className="elapsed-dot" />
      {elapsed}
    </span>
  );
}

function AgentPanel({ tasks }: { tasks: TaskRow[] }) {
  const activeAgents = new Set(tasks.filter((t) => t.status === "running").map((t) => t.agent));
  const allAgents = Object.keys(AGENT_PROFILES);

  const sorted = [...allAgents].sort((a, b) => {
    const aActive = activeAgents.has(a) ? 0 : 1;
    const bActive = activeAgents.has(b) ? 0 : 1;
    return aActive - bActive;
  });

  const visible = sorted.slice(0, 6);

  return (
    <div className="agent-panel">
      {visible.map((key, i) => {
        const profile = getAgentProfile(key);
        const isActive = activeAgents.has(key);
        return (
          <div
            key={key}
            className={`agent-panel-card ${isActive ? "active" : ""}`}
            style={{ animationDelay: `${i * 0.08}s` }}
          >
            <div className="agent-panel-icon" style={{ background: `${profile.color}18`, color: profile.color }}>
              {profile.icon}
              {isActive && <span className="ring" style={{ borderColor: profile.color }} />}
            </div>
            <div>
              <div className="agent-panel-name">{profile.name}</div>
              <div className="agent-panel-status">
                {isActive ? profile.statusPhrase : "Idle"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function traceStatusClass(status: string) {
  if (status === "running") return "running";
  if (status === "failed") return "failed";
  return "completed";
}

function traceLinePreview(entry: TaskLogRow) {
  const step = humanizeTaskDescription(entry.step);
  const detail = entry.detail?.trim();
  if (!detail) return { step, detail: "" };
  return {
    step,
    detail: detail.length > 240 ? `${detail.slice(0, 237)}...` : detail,
  };
}

const COMPLETED_DELAY_MS = 1500;
const COMPLETED_STAGGER_MS = 150;

export function AnimatedTaskQueue({
  tasks,
  logRows,
  projectNameMap,
}: {
  tasks: TaskRow[];
  logRows: TaskLogRow[];
  projectNameMap: Record<string, string>;
}) {
  const [showCompleted, setShowCompleted] = useState(false);
  const [completedFlash, setCompletedFlash] = useState<Set<string>>(new Set());
  const [newTaskIds, setNewTaskIds] = useState<Set<string>>(new Set());
  const [newLogIds, setNewLogIds] = useState<Set<string>>(new Set());
  const prevStatuses = useRef<Map<string, string>>(new Map());
  const prevTaskIds = useRef<Set<string>>(new Set());
  const prevLogIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (tasks.length === 0) return;
    const timer = setTimeout(() => setShowCompleted(true), COMPLETED_DELAY_MS);
    return () => clearTimeout(timer);
  }, [tasks.length]);

  // Detect new tasks + status transitions
  useEffect(() => {
    const flash = new Set<string>();
    const fresh = new Set<string>();
    for (const task of tasks) {
      const prev = prevStatuses.current.get(task.id);
      if (prev && prev !== "completed" && task.status === "completed") {
        flash.add(task.id);
      }
      if (!prevTaskIds.current.has(task.id) && prevTaskIds.current.size > 0) {
        fresh.add(task.id);
      }
      prevStatuses.current.set(task.id, task.status);
    }
    prevTaskIds.current = new Set(tasks.map((t) => t.id));

    if (fresh.size > 0) {
      setNewTaskIds(fresh);
      const t = setTimeout(() => setNewTaskIds(new Set()), 800);
      if (flash.size > 0) {
        setCompletedFlash(flash);
        const t2 = setTimeout(() => setCompletedFlash(new Set()), 2000);
        return () => { clearTimeout(t); clearTimeout(t2); };
      }
      return () => clearTimeout(t);
    }
    if (flash.size > 0) {
      setCompletedFlash(flash);
      const timeout = setTimeout(() => setCompletedFlash(new Set()), 2000);
      return () => clearTimeout(timeout);
    }
  }, [tasks]);

  // Detect new log entries
  useEffect(() => {
    const fresh = new Set<string>();
    for (const entry of logRows) {
      if (!prevLogIds.current.has(entry.id) && prevLogIds.current.size > 0) {
        fresh.add(entry.id);
      }
    }
    prevLogIds.current = new Set(logRows.map((e) => e.id));
    if (fresh.size > 0) {
      setNewLogIds(fresh);
      const t = setTimeout(() => setNewLogIds(new Set()), 800);
      return () => clearTimeout(t);
    }
  }, [logRows]);

  const nonCompleted = tasks.filter((t) => t.status !== "completed");
  const completed = tasks.filter((t) => t.status === "completed");
  const visibleTasks = showCompleted ? [...nonCompleted, ...completed] : nonCompleted;

  const logByProject = new Map<string, TaskLogRow[]>();
  for (const entry of logRows) {
    const arr = logByProject.get(entry.project_id) ?? [];
    arr.push(entry);
    logByProject.set(entry.project_id, arr);
  }

  return (
    <>
      <AgentPanel tasks={tasks} />

      <section className="studio-card">
        <h2>Task Queue</h2>
        {!tasks.length ? (
          <p className="meta-line">No tasks recorded yet.</p>
        ) : (
          <div className="table-shell">
            <table className="studio-table compact task-queue-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Agent</th>
                  <th>Task</th>
                  <th>Status</th>
                  <th>Time</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleTasks.map((task) => {
                  const agent = getAgentProfile(task.agent);
                  const output = taskOutputLink(task.description, task.project_id);
                  const isRunning = task.status === "running";
                  const isQueued = task.status === "queued";
                  const isCompleted = task.status === "completed";
                  const justCompleted = completedFlash.has(task.id);
                  const isNewTask = newTaskIds.has(task.id);
                  const completedIdx = isCompleted ? completed.indexOf(task) : -1;
                  const animStyle = isNewTask
                    ? { animation: "slideInDown 0.5s ease both" }
                    : isCompleted
                    ? { animation: `fadeInUp 0.4s ease ${completedIdx * (COMPLETED_STAGGER_MS / 1000)}s both` }
                    : {};

                  const traceEntries = (isRunning || isQueued)
                    ? (logByProject.get(task.project_id) ?? []).slice(0, 8)
                    : [];
                  const traceRows = traceEntries.map((entry) => {
                    const preview = traceLinePreview(entry);
                    return {
                      id: entry.id,
                      statusClass: traceStatusClass(entry.status),
                      step: preview.step,
                      detail: preview.detail,
                      createdAt: entry.created_at,
                    };
                  });

                  return (
                    <Fragment key={task.id}>
                      <tr
                        className={justCompleted ? "task-row-completed-glow" : isRunning ? "task-row-running" : ""}
                        style={animStyle}
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
                          {isRunning && (
                            <div className="shimmer-progress">
                              <div className="shimmer-fill" style={{ width: "60%" }} />
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={`task-status-badge ${task.status}`}>
                            {isRunning && <span className="task-running-dot" />}
                            {justCompleted ? (
                              <span className="check-pop">✓</span>
                            ) : (
                              task.status
                            )}
                          </span>
                        </td>
                        <td>
                          {isRunning ? (
                            <ElapsedTimer createdAt={task.created_at} />
                          ) : (
                            new Date(task.created_at).toLocaleString()
                          )}
                        </td>
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
                      {traceRows.length > 0 && (
                        <tr className="task-running-details-row">
                          <td colSpan={6}>
                            <div className="task-running-details-block">
                              {traceRows.map((trace) => (
                                <div key={trace.id} className="task-running-detail-line">
                                  <span className={`task-running-detail-dot ${trace.statusClass}`} />
                                  <span className="task-running-detail-step">{trace.step}</span>
                                  <span className="task-running-detail-text">{trace.detail || "--"}</span>
                                  <span className="task-running-detail-time">
                                    {new Date(trace.createdAt).toLocaleTimeString()}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
                  <tr
                    key={entry.id}
                    style={newLogIds.has(entry.id) ? { animation: "slideInDown 0.4s ease both" } : undefined}
                  >
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
