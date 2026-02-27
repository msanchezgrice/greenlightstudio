"use client";

import { useState } from "react";

export function RetryTaskButton({ projectId }: { projectId: string }) {
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    setRetrying(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceNewApproval: true }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null) as Record<string, unknown> | null;
        alert(typeof json?.error === "string" ? json.error : `Retry failed (HTTP ${res.status})`);
      } else {
        const json = await res.json().catch(() => null) as Record<string, unknown> | null;
        if (json?.alreadyRunning) {
          alert("A launch is already in progress for this project.");
        } else {
          window.location.reload();
        }
      }
    } catch {
      alert("Network error — please try again.");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <button
      className="btn btn-details btn-sm"
      style={{ color: "var(--green)", borderColor: "var(--green)" }}
      onClick={handleRetry}
      disabled={retrying}
    >
      {retrying ? "Retrying…" : "↻ Retry"}
    </button>
  );
}
