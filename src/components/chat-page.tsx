"use client";

import { useState, useEffect, useRef, useCallback, useMemo, FormEvent, ReactNode } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { AGENT_PROFILES } from "@/lib/phases";

type Project = {
  id: string;
  name: string;
  domain: string | null;
  phase: number;
  night_shift: boolean;
  confidence?: number | null;
};

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

function phaseLabel(phase: number): string {
  switch (phase) {
    case 0:
      return "Research";
    case 1:
      return "Validate";
    case 2:
      return "Distribute";
    case 3:
      return "Go Live";
    default:
      return `Phase ${phase}`;
  }
}

function statusColor(phase: number): string {
  switch (phase) {
    case 0:
      return "var(--yellow)";
    case 1:
      return "var(--blue)";
    case 2:
      return "var(--green)";
    case 3:
      return "var(--purple)";
    default:
      return "var(--text3)";
  }
}

const CEO = AGENT_PROFILES.ceo_agent;

function roleLabel(role: Message["role"]): string {
  if (role === "assistant") return CEO.name;
  if (role === "system") return "System";
  return "You";
}

function roleColor(role: Message["role"]): string {
  if (role === "assistant") return CEO.color;
  if (role === "system") return "var(--yellow)";
  return "#3B82F6";
}

function roleIcon(role: Message["role"]): string {
  if (role === "assistant") return CEO.icon;
  return "\u{1F464}";
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Content rendering: detect data cards, artifact links, and structured data
// ---------------------------------------------------------------------------

function renderMessageContent(content: string, role: string): ReactNode {
  if (role === "system") {
    return <div className="chat-msg-text">{content}</div>;
  }

  const parts: ReactNode[] = [];
  const lines = content.split("\n");
  let i = 0;
  let keyCounter = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Detect artifact-style links: [View packet ->](/projects/ID/packet)
    const artifactMatch = line.match(/^\[(.+?)\]\((\/.+?)\)\s*$/);
    if (artifactMatch) {
      parts.push(
        <Link key={`art-${keyCounter++}`} href={artifactMatch[2]} className="chat-msg-artifact green">
          {artifactMatch[1]}
        </Link>,
      );
      i++;
      continue;
    }

    // Detect card blocks: a line with an emoji + title, followed by "Key: Value" lines
    const cardTitleMatch = line.match(/^(.{1,4})\s+(.+)$/);
    const hasEmojiPrefix = cardTitleMatch && /[\p{Emoji}]/u.test(cardTitleMatch[1]);

    if (hasEmojiPrefix && i + 1 < lines.length) {
      // Look ahead to see if next lines are key: value pairs
      const kvLines: { key: string; value: string }[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const kvMatch = lines[j].match(/^([^:]{1,40}):\s+(.+)$/);
        if (kvMatch) {
          kvLines.push({ key: kvMatch[1].trim(), value: kvMatch[2].trim() });
          j++;
        } else if (lines[j].trim() === "") {
          j++;
          break;
        } else {
          break;
        }
      }

      if (kvLines.length >= 2) {
        parts.push(
          <div key={`card-${keyCounter++}`} className="msg-card chat-data-card-enter">
            <div className="msg-card-title">{line}</div>
            {kvLines.map((kv, idx) => (
              <div key={idx} className="msg-card-row">
                <span>{kv.key}</span>
                <span>{kv.value}</span>
              </div>
            ))}
          </div>,
        );
        i = j;
        continue;
      }
    }

    // Detect markdown-style bold key: value patterns like **Key:** Value
    const boldKvMatch = line.match(/^\*\*(.+?)\*\*:?\s+(.+)$/);
    if (boldKvMatch) {
      // Collect consecutive bold-kv lines into a card
      const kvLines: { key: string; value: string }[] = [];
      let j = i;
      while (j < lines.length) {
        const m = lines[j].match(/^\*\*(.+?)\*\*:?\s+(.+)$/);
        if (m) {
          kvLines.push({ key: m[1], value: m[2] });
          j++;
        } else {
          break;
        }
      }

      if (kvLines.length >= 2) {
        parts.push(
          <div key={`bcard-${keyCounter++}`} className="msg-card chat-data-card-enter">
            {kvLines.map((kv, idx) => (
              <div key={idx} className="msg-card-row">
                <span>{kv.key}</span>
                <span>{kv.value}</span>
              </div>
            ))}
          </div>,
        );
        i = j;
        continue;
      }
    }

    // Default: plain text line
    if (line.trim() === "" && parts.length > 0) {
      parts.push(<br key={`br-${keyCounter++}`} />);
    } else if (line.trim() !== "") {
      parts.push(<span key={`txt-${keyCounter++}`}>{line}{"\n"}</span>);
    }
    i++;
  }

  return <div className="chat-msg-text" style={{ whiteSpace: "pre-wrap" }}>{parts}</div>;
}

// ---------------------------------------------------------------------------
// Chat message cache — persisted to localStorage with TTL
// ---------------------------------------------------------------------------

const CHAT_CACHE_KEY = "sm_chat_cache";
const CHAT_CACHE_TTL_MS = 5 * 60 * 1000;

type CacheStore = Record<string, { messages: Message[]; ts: number }>;

function loadCacheStore(): CacheStore {
  try {
    const raw = localStorage.getItem(CHAT_CACHE_KEY);
    return raw ? (JSON.parse(raw) as CacheStore) : {};
  } catch {
    return {};
  }
}

function saveCacheStore(store: CacheStore) {
  try {
    localStorage.setItem(CHAT_CACHE_KEY, JSON.stringify(store));
  } catch { /* quota exceeded */ }
}

// ---------------------------------------------------------------------------
// Project Briefing — shows key actions & recent tasks in chat
// ---------------------------------------------------------------------------

type BriefingTask = {
  agent: string;
  description: string;
  status: string;
  detail: string | null;
  created_at: string;
};

type BriefingApproval = {
  title: string;
  status: string;
  risk: string;
  action_type: string;
};

function briefingSessionKey(projectId: string) {
  return `sm_briefing_seen_${projectId}`;
}

function ProjectBriefing({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<BriefingTask[]>([]);
  const [approvals, setApprovals] = useState<BriefingApproval[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [visible, setVisible] = useState(0);
  const [alreadySeen, setAlreadySeen] = useState(false);
  const prevProjectId = useRef<string | null>(null);

  useEffect(() => {
    if (projectId === prevProjectId.current) return;
    prevProjectId.current = projectId;
    setLoaded(false);
    setVisible(0);

    const seen = typeof window !== "undefined" && sessionStorage.getItem(briefingSessionKey(projectId)) === "1";
    setAlreadySeen(seen);

    fetch(`/api/projects/${projectId}/progress`, { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((progressData) => {
        const p = progressData as { tasks?: BriefingTask[]; approvals?: BriefingApproval[] } | null;
        const t = Array.isArray(p?.tasks) ? p.tasks.slice(0, 8) : [];
        setTasks(t);
        setApprovals(Array.isArray(p?.approvals) ? p.approvals.filter((a) => a.status === "pending").slice(0, 4) : []);
        setLoaded(true);
        if (t.length > 0 && typeof window !== "undefined") {
          sessionStorage.setItem(briefingSessionKey(projectId), "1");
        }
      })
      .catch(() => setLoaded(true));
  }, [projectId]);

  useEffect(() => {
    if (!loaded || tasks.length === 0 || alreadySeen) {
      if (loaded && alreadySeen) setVisible(tasks.length);
      return;
    }
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      setVisible(Math.min(count, tasks.length));
      if (count >= tasks.length) clearInterval(timer);
    }, 200);
    return () => clearInterval(timer);
  }, [loaded, tasks.length, alreadySeen]);

  if (!loaded || tasks.length === 0) return null;

  const visibleTasks = tasks.slice(0, visible);
  const runningTasks = tasks.filter((t) => t.status === "running");
  const completedTasks = tasks.filter((t) => t.status === "completed");
  const failedTasks = tasks.filter((t) => t.status === "failed");

  return (
    <div style={{ animation: "fadeInUp 0.4s ease both", marginBottom: 16 }}>
      <div className="chat-data-card chat-data-card-enter" style={{ borderColor: "#22c55e33" }}>
        <div className="chat-data-card-title">
          {CEO.icon} Recent Activity
        </div>
        <div className="chat-data-card-row">
          <span>Running</span>
          <span style={{ color: runningTasks.length > 0 ? "var(--yellow)" : "var(--text3)" }}>
            {runningTasks.length} task{runningTasks.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="chat-data-card-row">
          <span>Completed</span>
          <span style={{ color: "var(--green)" }}>{completedTasks.length}</span>
        </div>
        {failedTasks.length > 0 && (
          <div className="chat-data-card-row">
            <span>Failed</span>
            <span style={{ color: "var(--red)" }}>{failedTasks.length}</span>
          </div>
        )}
        {approvals.length > 0 && (
          <div className="chat-data-card-row">
            <span>Pending Approvals</span>
            <span style={{ color: "var(--yellow)" }}>{approvals.length}</span>
          </div>
        )}
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {visibleTasks.map((task, i) => {
            const agent = AGENT_PROFILES[task.agent] ?? { icon: "🤖", name: task.agent, color: "#94A3B8" };
            const isRunning = task.status === "running";
            return (
              <div
                key={`${task.description}-${task.created_at}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 11,
                  padding: "4px 6px",
                  borderRadius: 6,
                  background: isRunning ? "#eab30808" : "transparent",
                  animation: `fadeInUp 0.3s ease ${i * 0.15}s both`,
                }}
              >
                <span style={{ color: agent.color }}>{agent.icon}</span>
                <span style={{ color: "var(--text2)", flex: 1 }}>
                  {task.detail?.slice(0, 80) || task.description.replace(/_/g, " ")}
                </span>
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  color: isRunning ? "var(--yellow)" : task.status === "completed" ? "var(--green)" : task.status === "failed" ? "var(--red)" : "var(--text3)",
                }}>
                  {isRunning && "● "}{task.status}
                </span>
              </div>
            );
          })}
        </div>
        {approvals.length > 0 && (
          <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            {approvals.map((a, i) => (
              <Link
                key={i}
                href="/inbox"
                style={{
                  display: "block",
                  fontSize: 11,
                  color: "var(--yellow)",
                  padding: "3px 0",
                  textDecoration: "none",
                }}
              >
                ⚠ {a.title} — needs your review
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ChatPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("project"));

  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const messageCacheRef = useRef<CacheStore>(
    typeof window !== "undefined" ? loadCacheStore() : {},
  );

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? null,
    [projects, selectedId],
  );

  // Load project list
  useEffect(() => {
    let active = true;
    setLoadingProjects(true);

    fetch("/api/projects")
      .then((res) => res.json())
      .then((data: Project[]) => {
        if (!active) return;
        setProjects(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!active) return;
        setProjects([]);
      })
      .finally(() => {
        if (active) setLoadingProjects(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const loadMessages = useCallback(async (projectId: string) => {
    const entry = messageCacheRef.current[projectId];
    const isFresh = entry && (Date.now() - entry.ts) < CHAT_CACHE_TTL_MS;

    if (entry) {
      setMessages(entry.messages);
      setLoadingMessages(false);
    } else {
      setLoadingMessages(true);
    }

    setError(null);

    if (isFresh) return;

    try {
      const res = await fetch(`/api/projects/${projectId}/chat`, { cache: "no-store" });
      const raw = await res.text();
      const json = raw.trim()
        ? (JSON.parse(raw) as { messages?: Message[]; error?: string })
        : null;

      if (!res.ok) {
        throw new Error(json?.error ?? `Failed to load chat (HTTP ${res.status})`);
      }

      const freshMessages = Array.isArray(json?.messages) ? json.messages : [];
      messageCacheRef.current[projectId] = { messages: freshMessages, ts: Date.now() };
      saveCacheStore(messageCacheRef.current);
      setMessages(freshMessages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load messages");
      if (!entry) setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) {
      delete messageCacheRef.current[selectedId];
      loadMessages(selectedId);
    } else {
      setMessages([]);
    }
  }, [selectedId, loadMessages]);

  useEffect(() => {
    if (!selectedId || sending) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        delete messageCacheRef.current[selectedId];
        loadMessages(selectedId);
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [selectedId, sending, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending]);

  function selectProject(id: string) {
    setSelectedId(id);
    setInput("");
    setError(null);
    router.replace(`/chat?project=${id}`, { scroll: false });
  }

  const canSend = useMemo(
    () => input.trim().length > 0 && !sending && !!selectedId,
    [input, sending, selectedId],
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || sending || !selectedId) return;

    setSending(true);
    setError(null);
    setInput("");

    // Optimistic add
    const optimisticMsg: Message = {
      id: `optimistic-${Date.now()}`,
      role: "user",
      content: message,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    try {
      const res = await fetch(`/api/projects/${selectedId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      const raw = await res.text();
      const json = raw.trim() ? (JSON.parse(raw) as { error?: string }) : null;

      if (!res.ok) {
        throw new Error(json?.error ?? `Failed to send message (HTTP ${res.status})`);
      }

      delete messageCacheRef.current[selectedId];
      await loadMessages(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
      setInput(message);
      // Remove optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-layout">
      {/* Sidebar */}
      <aside className="chat-sidebar">
        <div className="chat-sidebar-header">Projects</div>
        <div className="chat-project-list">
          {loadingProjects ? (
            <p className="meta-line" style={{ padding: "12px" }}>Loading projects...</p>
          ) : projects.length === 0 ? (
            <div style={{ padding: "24px 12px", textAlign: "center" }}>
              <p style={{ color: "var(--text3)", fontSize: 13, marginBottom: 12 }}>No projects yet.</p>
              <Link
                href="/onboarding?new=1"
                className="btn btn-approve"
                style={{ fontSize: 12, padding: "7px 14px" }}
              >
                + New Project
              </Link>
            </div>
          ) : (
            projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className={`chat-project-item${selectedId === project.id ? " active" : ""}`}
                onClick={() => selectProject(project.id)}
              >
                <div className="chat-project-name" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    className="chat-project-dot"
                    style={{ background: statusColor(project.phase) }}
                  />
                  {project.name}
                </div>
                <div className="chat-project-sub">
                  Phase {project.phase} &middot; {phaseLabel(project.phase)}
                </div>
              </button>
            ))
          )}
        </div>

        {/* --- Feature 5: Updated Quick Actions --- */}
        <div className="chat-quick-actions">
          <div className="chat-sidebar-header">Quick Actions</div>
          <Link href="/onboarding?new=1" className="chat-project-item">
            <span className="chat-project-name" style={{ fontSize: 12 }}>+ New Project</span>
          </Link>
          <Link href="/bulk-import" className="chat-project-item">
            <span className="chat-project-name" style={{ fontSize: 12 }}>Bulk Import</span>
          </Link>
          <Link href="/board" className="chat-project-item">
            <span className="chat-project-name" style={{ fontSize: 12 }}>Board</span>
          </Link>
        </div>
      </aside>

      {/* Main chat area */}
      <main className="chat-main">
        {selectedProject ? (
          <>
            {/* --- Feature 4: Improved header with confidence + new buttons --- */}
            <div className="chat-header">
              <div className="chat-header-info">
                <div className="chat-header-icon">
                  <span style={{ fontSize: "16px" }}>&#9650;</span>
                </div>
                <div>
                  <Link
                    href={`/projects/${selectedProject.id}`}
                    className="chat-header-name"
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    {selectedProject.name}
                  </Link>
                  <div className="chat-header-phase">
                    {selectedProject.domain ? `${selectedProject.domain} \u00B7 ` : ""}
                    Phase {selectedProject.phase} &middot; {phaseLabel(selectedProject.phase)}
                    {selectedProject.confidence != null && (
                      <> &middot; Confidence {selectedProject.confidence}</>
                    )}
                  </div>
                </div>
              </div>
              <div className="chat-header-actions">
                <Link
                  href={`/projects/${selectedProject.id}/packet`}
                  className="chat-header-btn"
                >
                  Packet
                </Link>
                <Link
                  href={`/inbox?project=${selectedProject.id}`}
                  className="chat-header-btn"
                >
                  Inbox
                </Link>
                <Link
                  href={`/projects/${selectedProject.id}/phases`}
                  className="chat-header-btn green"
                >
                  Phases
                </Link>
              </div>
            </div>

            {/* Messages */}
            <div className="chat-body">
              {error && <p className="alert error">{error}</p>}

              <ProjectBriefing projectId={selectedProject.id} />

              {loadingMessages && messages.length === 0 ? (
                <p className="meta-line" style={{ padding: "24px", textAlign: "center" }}>
                  Loading messages...
                </p>
              ) : messages.length === 0 ? (
                <div className="chat-empty-state">
                  <p style={{ color: "var(--heading)", fontWeight: 600, marginBottom: 8 }}>
                    No messages yet.
                  </p>
                  <p className="meta-line">
                    Ask your CEO agent about strategy, execution, or next steps for this project.
                  </p>
                </div>
              ) : (
                messages.map((msg) => {
                  // --- Feature 2: System messages render differently ---
                  if (msg.role === "system") {
                    return (
                      <div key={msg.id} className="chat-msg system">
                        <div className="chat-msg-content">
                          <div className="chat-msg-header">
                            <span className="chat-msg-time">{formatTime(msg.created_at)}</span>
                          </div>
                          <div className="chat-msg-text">
                            <span style={{ fontSize: 14 }}>{"\u2699\uFE0F"}</span> {msg.content}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={msg.id} className={`chat-msg ${msg.role} chat-msg-enter`}>
                      <div
                        className={`chat-msg-avatar ${msg.role === "assistant" ? "agent" : msg.role}`}
                        style={msg.role === "assistant" ? {
                          background: `linear-gradient(135deg, ${CEO.color}30, ${CEO.color}60)`,
                          border: `2px solid ${CEO.color}`,
                        } : undefined}
                      >
                        {roleIcon(msg.role)}
                      </div>
                      <div className="chat-msg-content">
                        <div className="chat-msg-header">
                          <span className="chat-msg-name" style={{ color: roleColor(msg.role) }}>
                            {roleLabel(msg.role)}
                          </span>
                          <span className="chat-msg-time">{formatTime(msg.created_at)}</span>
                        </div>
                        {/* --- Feature 3: Rich message content rendering --- */}
                        {renderMessageContent(msg.content, msg.role)}
                      </div>
                    </div>
                  );
                })
              )}

              {sending && (
                <div className="thinking-bubble">
                  <div className="thinking-avatar">
                    {CEO.icon}
                    <span className="pulse-ring" />
                  </div>
                  <div className="thinking-content">
                    <div className="thinking-dots">
                      <span /><span /><span />
                    </div>
                    <span className="thinking-label">{CEO.statusPhrase}</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form className="chat-input-bar" onSubmit={onSubmit}>
              <textarea
                ref={textareaRef}
                placeholder={`Ask your CEO agent anything about ${selectedProject.name}...`}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (canSend) {
                      const form = e.currentTarget.closest("form");
                      form?.requestSubmit();
                    }
                  }
                }}
                maxLength={3000}
                disabled={sending}
                rows={1}
              />
              <button type="submit" className="chat-send-btn" disabled={!canSend}>
                {sending ? "Sending..." : "Send"}
              </button>
            </form>
          </>
        ) : (
          <div className="chat-no-project">
            {projects.length === 0 ? (
              <>
                <div style={{ fontSize: 40, marginBottom: 16 }}>💬</div>
                <h2 style={{ marginBottom: 8, color: "var(--heading)" }}>Chat with Your AI CEO</h2>
                <p className="meta-line" style={{ maxWidth: 400, marginBottom: 16 }}>
                  Create a project to start chatting with your CEO agent about strategy, execution, and next steps.
                </p>
                <Link
                  href="/onboarding?new=1"
                  className="btn btn-approve"
                  style={{ fontSize: 14, padding: "10px 24px" }}
                >
                  Create a Project
                </Link>
              </>
            ) : (
              <>
                <h2 style={{ marginBottom: 8, color: "var(--heading)" }}>Select a project to start chatting</h2>
                <p className="meta-line">
                  Choose a project from the sidebar to chat with your CEO agent.
                </p>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
