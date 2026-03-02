"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TechNewsRefreshButtonProps = {
  projectId: string;
  autoOnMount?: boolean;
  generatedAt?: string | null;
  staleAfterMinutes?: number;
};

export function TechNewsRefreshButton({
  projectId,
  autoOnMount = false,
  generatedAt = null,
  staleAfterMinutes = 240,
}: TechNewsRefreshButtonProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [autoQueued, setAutoQueued] = useState(false);
  const autoQueuedRef = useRef(false);

  const shouldAutoRefresh = useMemo(() => {
    if (!autoOnMount) return false;
    if (!generatedAt) return true;
    const parsed = Date.parse(generatedAt);
    if (!Number.isFinite(parsed)) return true;
    return Date.now() - parsed >= staleAfterMinutes * 60_000;
  }, [autoOnMount, generatedAt, staleAfterMinutes]);

  const triggerRefresh = useCallback(async (options?: { reloadAfterQueue?: boolean; auto?: boolean }) => {
    if (pending) return;
    const reloadAfterQueue = options?.reloadAfterQueue ?? true;
    const auto = options?.auto === true;
    setPending(true);
    setError(null);
    setQueued(false);
    if (!auto) setAutoQueued(false);
    try {
      const response = await fetch(`/api/projects/${projectId}/tech-news/refresh`, {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to queue refresh");
      }
      if (auto) {
        setAutoQueued(true);
      } else {
        setQueued(true);
      }
      if (reloadAfterQueue) {
        setTimeout(() => {
          window.location.reload();
        }, 900);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to queue refresh");
    } finally {
      setPending(false);
    }
  }, [pending, projectId]);

  useEffect(() => {
    if (!shouldAutoRefresh || autoQueuedRef.current) return;
    const storageKey = `tech-news-autorefresh:${projectId}`;
    const now = Date.now();
    try {
      const lastRunRaw = window.sessionStorage.getItem(storageKey);
      if (lastRunRaw) {
        const lastRun = Number(lastRunRaw);
        if (Number.isFinite(lastRun) && now - lastRun < 5 * 60_000) {
          return;
        }
      }
      window.sessionStorage.setItem(storageKey, String(now));
    } catch {
      // Ignore storage errors in private mode.
    }
    autoQueuedRef.current = true;
    void triggerRefresh({ reloadAfterQueue: false, auto: true });
  }, [projectId, shouldAutoRefresh, triggerRefresh]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
      <button type="button" className="btn btn-details" onClick={() => void triggerRefresh()} disabled={pending}>
        {pending ? "Queueing..." : "Refresh Now"}
      </button>
      {queued && <span className="meta-line good">Refresh queued. Reloading…</span>}
      {autoQueued && <span className="meta-line">Auto-refresh queued on page load.</span>}
      {error && <span className="meta-line bad">{error}</span>}
    </div>
  );
}
