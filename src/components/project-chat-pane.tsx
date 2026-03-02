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

const CHAT_CACHE_KEY = "sm_chat_cache";
const CHAT_CACHE_TTL_MS = 5 * 60 * 1000;
const CHAT_CACHE_EVENT = "sm-chat-cache-updated";

type CacheStore = Record<string, { messages: ChatMessage[]; ts: number }>;

function loadChatCacheStore(): CacheStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CHAT_CACHE_KEY);
    return raw ? (JSON.parse(raw) as CacheStore) : {};
  } catch {
    return {};
  }
}

function saveChatCacheStore(store: CacheStore) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHAT_CACHE_KEY, JSON.stringify(store));
  } catch {
    // ignore localStorage write failures
  }
}

function emitChatCacheUpdate(projectId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(CHAT_CACHE_EVENT, {
      detail: { projectId },
    }),
  );
}

function roleLabel(role: ChatMessage["role"]) {
  if (role === "assistant") return "CEO Agent";
  if (role === "system") return "System";
  return "You";
}

type SSEEvent = {
  id: string;
  jobId: string;
  type: string;
  message: string | null;
  data: Record<string, unknown>;
  createdAt: string;
};

function useJobStream(
  projectId: string,
  jobId: string | null,
  onDelta: (text: string) => void,
  onDone: () => void
) {
  useEffect(() => {
    if (!jobId) return;

    const source = new EventSource(`/api/projects/${projectId}/events?jobId=${jobId}`);

    source.onmessage = (rawEvent) => {
      if (!rawEvent.data) return;
      try {
        const event = JSON.parse(rawEvent.data) as SSEEvent;
        if (event.type === "delta" && event.message) {
          onDelta(event.message);
          return;
        }
        if (event.type === "done") {
          onDone();
          source.close();
        }
      } catch {
        // Ignore malformed events and keep stream open.
      }
    };

    source.onerror = () => {
      source.close();
      onDone();
    };

    return () => {
      source.close();
    };
  }, [projectId, jobId, onDelta, onDone]);
}

export function ProjectChatPane({ projectId, title = "Project Chat", deliverableLinks }: ProjectChatPaneProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [streamingJobId, setStreamingJobId] = useState<string | null>(null);
  const [streamBuffer, setStreamBuffer] = useState("");
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const cacheRef = useRef<CacheStore>(loadChatCacheStore());

  const reloadMessages = useCallback(async (forceNetwork = false) => {
    const cached = cacheRef.current[projectId];
    const isFresh = Boolean(cached && Date.now() - cached.ts < CHAT_CACHE_TTL_MS);

    if (cached?.messages) {
      setMessages(cached.messages);
      setLoading(false);
    }

    if (!forceNetwork && isFresh && !cached?.messages?.length) return;

    const response = await fetch(`/api/projects/${projectId}/chat`, { cache: "no-store" });
    const raw = await response.text();
    const json = raw.trim() ? (JSON.parse(raw) as { messages?: ChatMessage[]; error?: string }) : null;

    if (!response.ok) {
      throw new Error(json?.error || `Failed to load chat (HTTP ${response.status})`);
    }

    const freshMessages = Array.isArray(json?.messages) ? json.messages : [];
    cacheRef.current[projectId] = { messages: freshMessages, ts: Date.now() };
    saveChatCacheStore(cacheRef.current);
    setMessages(freshMessages);
  }, [projectId]);

  useEffect(() => {
    let active = true;
    const cached = cacheRef.current[projectId];
    setLoading(!cached?.messages?.length);
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
  }, [projectId, reloadMessages]);

  useEffect(() => {
    const onCacheEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId !== projectId) return;
      reloadMessages(true).catch(() => {});
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CHAT_CACHE_KEY) return;
      reloadMessages(true).catch(() => {});
    };

    window.addEventListener(CHAT_CACHE_EVENT, onCacheEvent as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHAT_CACHE_EVENT, onCacheEvent as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, [projectId, reloadMessages]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [messages.length, sending, streamBuffer]);

  const canSend = useMemo(() => input.trim().length > 0 && !sending, [input, sending]);

  const handleDelta = useCallback((text: string) => {
    setStreamBuffer((prev) => prev + text);
  }, []);

  const handleStreamDone = useCallback(() => {
    setStreamingJobId(null);
    setStreamBuffer("");
    setSending(false);
    delete cacheRef.current[projectId];
    saveChatCacheStore(cacheRef.current);
    emitChatCacheUpdate(projectId);
    reloadMessages(true).catch(() => {});
  }, [projectId, reloadMessages]);

  useJobStream(projectId, streamingJobId, handleDelta, handleStreamDone);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || sending) return;

    setSending(true);
    setError(null);
    setInput("");
    setStreamBuffer("");

    setMessages((prev) => [
      ...prev,
      {
        id: `optimistic-${Date.now()}`,
        role: "user",
        content: message,
        created_at: new Date().toISOString(),
      },
    ]);

    try {
      const response = await fetch(`/api/projects/${projectId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      const raw = await response.text();
      const json = raw.trim()
        ? (JSON.parse(raw) as { error?: string; jobId?: string; streaming?: boolean })
        : null;

      if (!response.ok) {
        throw new Error(json?.error || `Failed to send message (HTTP ${response.status})`);
      }

      if (json?.streaming && json.jobId) {
        setStreamingJobId(json.jobId);
      } else {
        delete cacheRef.current[projectId];
        saveChatCacheStore(cacheRef.current);
        await reloadMessages(true);
        emitChatCacheUpdate(projectId);
        setSending(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
      setInput(message);
      setMessages((prev) => prev.filter((m) => !m.id.startsWith("optimistic-")));
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
            reloadMessages(true)
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
        ) : !messages.length && !streamBuffer ? (
          <p className="meta-line">Ask your CEO agent about strategy, execution, or next steps for this project.</p>
        ) : (
          <>
            {messages.map((message) => (
              <article key={message.id} className={`chat-message ${message.role}`}>
                <div className="chat-message-meta">
                  <span>{roleLabel(message.role)}</span>
                  <span>{new Date(message.created_at).toLocaleTimeString()}</span>
                </div>
                <div className="chat-message-body">{message.content}</div>
              </article>
            ))}
            {(sending || streamBuffer) && (
              <article className="chat-message assistant streaming">
                <div className="chat-message-meta">
                  <span>CEO Agent</span>
                  <span className="streaming-indicator">{streamBuffer ? "typing…" : "thinking…"}</span>
                </div>
                <div className="chat-message-body">
                  {streamBuffer || <span className="streaming-placeholder">Analyzing project context…</span>}
                </div>
              </article>
            )}
          </>
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
            {sending ? (streamBuffer ? "Streaming…" : "Thinking…") : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}
