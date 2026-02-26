"use client";

import { useState, useEffect, useRef, useCallback, useMemo, FormEvent, ReactNode } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";

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
      return "Build";
    case 2:
      return "Distribute";
    case 3:
      return "Scale";
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

function roleLabel(role: Message["role"]): string {
  if (role === "assistant") return "CEO Agent";
  if (role === "system") return "System";
  return "You";
}

function roleColor(role: Message["role"]): string {
  if (role === "assistant") return "var(--green)";
  if (role === "system") return "var(--yellow)";
  return "#3B82F6";
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
          <div key={`card-${keyCounter++}`} className="msg-card">
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
          <div key={`bcard-${keyCounter++}`} className="msg-card">
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

  // --- Feature 1: Client-side message cache ---
  const messageCacheRef = useRef<Map<string, Message[]>>(new Map());

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

  // Load messages when project changes (with cache)
  const loadMessages = useCallback(async (projectId: string) => {
    // Show cached messages instantly if available
    const cached = messageCacheRef.current.get(projectId);
    if (cached) {
      setMessages(cached);
      setLoadingMessages(false);
    } else {
      setLoadingMessages(true);
    }

    setError(null);

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
      messageCacheRef.current.set(projectId, freshMessages);
      setMessages(freshMessages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load messages");
      if (!cached) setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) {
      loadMessages(selectedId);
    } else {
      setMessages([]);
    }
  }, [selectedId, loadMessages]);

  // Scroll to bottom on new messages
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

      // Reload all messages to get assistant reply
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
            <p className="meta-line" style={{ padding: "12px" }}>No projects yet.</p>
          ) : (
            projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className={`chat-project-item${selectedId === project.id ? " active" : ""}`}
                onClick={() => selectProject(project.id)}
              >
                <div className="chat-project-name">
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
                  <div className="chat-header-name">{selectedProject.name}</div>
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
                    <div key={msg.id} className={`chat-msg ${msg.role}`}>
                      <div
                        className={`chat-msg-avatar ${msg.role === "assistant" ? "agent" : msg.role}`}
                      >
                        {msg.role === "assistant"
                          ? "\u{1F9E0}"
                          : "\u{1F464}"}
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
                <div className="chat-msg assistant">
                  <div className="chat-msg-avatar agent">{"\u{1F9E0}"}</div>
                  <div className="chat-msg-content">
                    <div className="chat-msg-header">
                      <span className="chat-msg-name" style={{ color: "var(--green)" }}>
                        CEO Agent
                      </span>
                    </div>
                    <div className="chat-msg-text" style={{ opacity: 0.6 }}>Thinking...</div>
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
            <h2 style={{ marginBottom: 8 }}>Select a project to start chatting</h2>
            <p className="meta-line">
              Choose a project from the sidebar to chat with your CEO agent.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
