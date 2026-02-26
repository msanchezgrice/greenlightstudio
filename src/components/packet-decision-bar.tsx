"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Decision = "approved" | "revised" | "denied";

type Props = {
  projectId: string;
  approvalId: string | null;
  approvalVersion: number | null;
  approvalStatus: "pending" | "approved" | "denied" | "revised" | null;
};

type DecisionResponse = {
  error?: string;
  version?: number;
};

async function parseResponseJson(response: Response) {
  const raw = await response.text();
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as DecisionResponse;
  } catch {
    return null;
  }
}

export function PacketDecisionBar({ projectId, approvalId, approvalVersion, approvalStatus }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<Decision | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState(approvalStatus);

  const canDecide = Boolean(approvalId && approvalVersion && status === "pending");

  async function submitDecision(decision: Decision) {
    if (!approvalId || !approvalVersion) return;

    setBusy(decision);
    setNotice(null);

    try {
      const response = await fetch(`/api/inbox/${approvalId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, version: approvalVersion }),
      });
      const json = await parseResponseJson(response);
      if (!response.ok) {
        throw new Error(json?.error ?? `Decision failed (HTTP ${response.status})`);
      }

      setStatus(decision);
      const label = decision === "approved" ? "approved" : decision === "revised" ? "revision requested" : "killed";
      setNotice(`Phase 0 packet ${label}.`);
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Decision failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="packet-action-bar">
      <div className="packet-action-inner">
        <div className="packet-action-buttons">
          <button
            type="button"
            className="packet-action-btn approve"
            onClick={() => submitDecision("approved")}
            disabled={!canDecide || busy !== null}
          >
            {busy === "approved" ? "Approving..." : "Approve Phase 1"}
          </button>
          <button
            type="button"
            className="packet-action-btn revise"
            onClick={() => submitDecision("revised")}
            disabled={!canDecide || busy !== null}
          >
            {busy === "revised" ? "Requesting..." : "Request Revisions"}
          </button>
          <button
            type="button"
            className="packet-action-btn kill"
            onClick={() => submitDecision("denied")}
            disabled={!canDecide || busy !== null}
          >
            {busy === "denied" ? "Killing..." : "Kill Project"}
          </button>
          <Link href="/inbox" className="packet-action-btn neutral">
            Open Inbox
          </Link>
          <Link href={`/projects/${projectId}/phases`} className="packet-action-btn neutral">
            Phase Dashboard
          </Link>
        </div>
        {notice && <div className="packet-action-notice">{notice}</div>}
        {!notice && !canDecide && (
          <div className="packet-action-notice">No pending packet decision. Use Inbox for current approvals.</div>
        )}
      </div>
    </div>
  );
}
