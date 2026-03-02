"use client";

import { useState } from "react";

type Props = {
  projectId: string;
  phase: number;
  assetId?: string | null;
  label?: string;
  placeholder?: string;
};

export function PhaseRefineControl({
  projectId,
  phase,
  assetId,
  label = "Request Refinement",
  placeholder = "Describe exactly what to change...",
}: Props) {
  const [guidance, setGuidance] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    const trimmed = guidance.trim();
    if (trimmed.length < 8 || busy) {
      setNotice("Please provide at least 8 characters of guidance.");
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase, assetId: assetId ?? null, guidance: trimmed }),
      });
      const json = (await response.json().catch(() => null)) as { error?: string; approvalId?: string; existing?: boolean } | null;
      if (!response.ok) {
        throw new Error(json?.error || `Failed to request refinement (HTTP ${response.status})`);
      }

      setGuidance("");
      setNotice(json?.existing
        ? "A refinement request is already pending in Inbox."
        : "Refinement request queued in Inbox for approval.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to queue refinement request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
      <div className="metric-label">{label}</div>
      <textarea
        className="mock-textarea"
        style={{ minHeight: 80 }}
        placeholder={placeholder}
        value={guidance}
        onChange={(event) => setGuidance(event.target.value)}
        maxLength={1600}
        disabled={busy}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-preview" onClick={submit} disabled={busy || guidance.trim().length < 8}>
          {busy ? "Queueing..." : "Queue Refinement"}
        </button>
        <a href={`/inbox?project=${projectId}`} className="btn btn-details">
          Open Inbox
        </a>
        {notice && <span className="meta-line">{notice}</span>}
      </div>
    </div>
  );
}
