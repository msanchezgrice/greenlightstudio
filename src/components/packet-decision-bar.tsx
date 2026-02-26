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
  phase0RelaunchRequired?: boolean;
  projectId?: string;
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
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseGuidance, setReviseGuidance] = useState("");

  const canDecide = Boolean(approvalId && approvalVersion && status === "pending");

  async function submitDecision(decision: Decision, guidance?: string) {
    if (!approvalId || !approvalVersion) return;

    setBusy(decision);
    setNotice(null);

    try {
      const response = await fetch(`/api/inbox/${approvalId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, version: approvalVersion, guidance }),
      });
      const json = await parseResponseJson(response);
      if (!response.ok) {
        throw new Error(json?.error ?? `Decision failed (HTTP ${response.status})`);
      }

      setStatus(decision);
      if (decision === "revised" && json?.phase0RelaunchRequired) {
        const launchResponse = await fetch(`/api/projects/${projectId}/launch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            revisionGuidance: guidance ?? "",
            forceNewApproval: true,
          }),
        });
        const launchJson = await parseResponseJson(launchResponse);
        if (!launchResponse.ok) {
          throw new Error(
            `Revision saved, but relaunch failed: ${
              launchJson?.error ?? `HTTP ${launchResponse.status}`
            }`,
          );
        }
      }

      const label = decision === "approved" ? "approved" : decision === "revised" ? "revision requested" : "killed";
      setNotice(`Phase 0 packet ${label}.`);
      setReviseOpen(false);
      setReviseGuidance("");
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
            onClick={() => {
              setNotice(null);
              setReviseOpen((prev) => !prev);
            }}
            disabled={!canDecide || busy !== null}
          >
            {busy === "revised" ? "Requesting..." : reviseOpen ? "Close Revisions" : "Request Revisions"}
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
        {reviseOpen && canDecide && (
          <div className="packet-revise-panel">
            <label className="packet-revise-label" htmlFor="packet-revise-guidance">
              Guidance for CEO agent retry
            </label>
            <textarea
              id="packet-revise-guidance"
              className="packet-revise-input"
              value={reviseGuidance}
              onChange={(event) => setReviseGuidance(event.target.value)}
              placeholder="Explain what should change before re-running this phase..."
            />
            <div className="packet-revise-actions">
              <button
                type="button"
                className="packet-action-btn revise"
                disabled={busy !== null || reviseGuidance.trim().length < 8}
                onClick={() => submitDecision("revised", reviseGuidance.trim())}
              >
                {busy === "revised" ? "Submitting..." : "Submit Revision Guidance"}
              </button>
              <button
                type="button"
                className="packet-action-btn neutral"
                disabled={busy !== null}
                onClick={() => setReviseOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {notice && <div className="packet-action-notice">{notice}</div>}
        {!notice && !canDecide && (
          <div className="packet-action-notice">No pending packet decision. Use Inbox for current approvals.</div>
        )}
      </div>
    </div>
  );
}
