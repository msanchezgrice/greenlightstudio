"use client";

import { useState } from "react";

type TechNewsRefreshButtonProps = {
  projectId: string;
};

export function TechNewsRefreshButton({ projectId }: TechNewsRefreshButtonProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  async function triggerRefresh() {
    if (pending) return;
    setPending(true);
    setError(null);
    setQueued(false);
    try {
      const response = await fetch(`/api/projects/${projectId}/tech-news/refresh`, {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to queue refresh");
      }
      setQueued(true);
      setTimeout(() => {
        window.location.reload();
      }, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to queue refresh");
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
      <button type="button" className="btn btn-details" onClick={triggerRefresh} disabled={pending}>
        {pending ? "Queueing..." : "Refresh Now"}
      </button>
      {queued && <span className="meta-line good">Refresh queued. Reloading…</span>}
      {error && <span className="meta-line bad">{error}</span>}
    </div>
  );
}
