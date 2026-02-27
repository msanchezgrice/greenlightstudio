"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

type DeliverableLink = {
  label: string;
  href: string;
  external?: boolean;
};

type ProjectChatPaneProps = {
  projectId: string;
  title?: string;
  deliverableLinks?: DeliverableLink[];
};

function roleLabel(role: ChatMessage["role"]) {
  if (role === "assistant") return "CEO Agent";
  if (role === "system") return "System";
  return "You";
}

export function ProjectChatPane({ projectId, title = "Project Chat", deliverableLinks }: ProjectChatPaneProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const reloadMessages = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/chat`, { cache: "no-store" });
    const raw = await response.text();
    const json = raw.trim() ? (JSON.parse(raw) as { messages?: ChatMessage[]; error?: string }) : null;

    if (!response.ok) {
      throw new Error(json?.error || `Failed to load chat (HTTP ${response.status})`);
    }

    setMessages(Array.isArray(json?.messages) ? json.messages : []);
  }, [projectId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    reloadMessages()
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load chat");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [reloadMessages]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [messages.length, sending]);

  const canSend = useMemo(() => input.trim().length > 0 && !sending, [input, sending]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || sending) return;

    setSending(true);
    setError(null);
    setInput("");

    try {
      const response = await fetch(`/api/projects/${projectId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      const raw = await response.text();
      const json = raw.trim() ? (JSON.parse(raw) as { error?: string }) : null;
      if (!response.ok) {
        throw new Error(json?.error || `Failed to send message (HTTP ${response.status})`);
      }

      await reloadMessages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
      setInput(message);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="studio-card chat-pane">
      <div className="chat-pane-header">
        <h2>{title}</h2>
        <button
          type="button"
          className="btn btn-details"
          onClick={() => {
            setError(null);
            setLoading(true);
            reloadMessages()
              .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load chat"))
              .finally(() => setLoading(false));
          }}
          disabled={loading || sending}
        >
          Refresh
        </button>
      </div>

      {deliverableLinks && deliverableLinks.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "8px 0", borderBottom: "1px solid var(--border, rgba(255,255,255,.08))", marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text3, #64748B)", textTransform: "uppercase", letterSpacing: ".04em", alignSelf: "center" }}>Deliverables:</span>
          {deliverableLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target={link.external ? "_blank" : undefined}
              rel={link.external ? "noopener noreferrer" : undefined}
              className="btn btn-details btn-sm"
              style={{ fontSize: 11, padding: "3px 10px" }}
            >
              {link.label}
            </a>
          ))}
        </div>
      )}

      {error && <p className="meta-line bad">{error}</p>}

      <div className="chat-messages" ref={viewportRef}>
        {loading ? (
          <p className="meta-line">Loading chat…</p>
        ) : !messages.length ? (
          <p className="meta-line">Ask your CEO agent about strategy, execution, or next steps for this project.</p>
        ) : (
          messages.map((message) => (
            <article key={message.id} className={`chat-message ${message.role}`}>
              <div className="chat-message-meta">
                <span>{roleLabel(message.role)}</span>
                <span>{new Date(message.created_at).toLocaleTimeString()}</span>
              </div>
              <div className="chat-message-body">{message.content}</div>
            </article>
          ))
        )}
      </div>

      <form className="chat-input-row" onSubmit={onSubmit}>
        <textarea
          className="mock-textarea chat-textarea"
          placeholder="Ask the CEO agent a question about this project..."
          value={input}
          onChange={(event) => setInput(event.target.value)}
          maxLength={3000}
          disabled={sending}
        />
        <div className="button-row">
          <button type="submit" className="mock-btn primary" disabled={!canSend}>
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}
