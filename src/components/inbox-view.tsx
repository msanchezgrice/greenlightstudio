"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StudioNav } from "@/components/studio-nav";
import { packetSchema } from "@/types/domain";

type Decision = "approved" | "denied" | "revised";

type Item = {
  id: string;
  project_id: string;
  project_name: string;
  phase: number;
  title: string;
  description: string;
  risk: "high" | "medium" | "low";
  action_type: string;
  payload: Record<string, unknown>;
  status: "pending" | "approved" | "denied" | "revised";
  version: number;
  created_at: string;
  decided_at: string | null;
};

type DecisionResponse = {
  error?: string;
  version?: number;
  phase0RelaunchRequired?: boolean;
};

function relativeTime(date: string) {
  const now = Date.now();
  const diff = Math.round((new Date(date).getTime() - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 60) return `${abs}s ${diff < 0 ? "ago" : "from now"}`;
  if (abs < 3600) return `${Math.round(abs / 60)}m ${diff < 0 ? "ago" : "from now"}`;
  if (abs < 86400) return `${Math.round(abs / 3600)}h ${diff < 0 ? "ago" : "from now"}`;
  return `${Math.round(abs / 86400)}d ${diff < 0 ? "ago" : "from now"}`;
}

function actionBucket(actionType: string) {
  if (actionType.includes("deploy")) return "Deploys";
  if (actionType.includes("ad")) return "Ads";
  if (actionType.includes("outreach") || actionType.includes("email")) return "Outreach";
  return "All";
}

function riskClass(risk: Item["risk"]) {
  if (risk === "high") return "risk-high";
  if (risk === "medium") return "risk-medium";
  return "risk-low";
}

function pendingClass(risk: Item["risk"]) {
  if (risk === "high") return "urgent";
  if (risk === "medium") return "medium";
  return "low";
}

function parseSynopsis(payload: Record<string, unknown>) {
  const parsed = packetSchema.safeParse(payload);
  if (!parsed.success) return null;
  return parsed.data.reasoning_synopsis;
}

export function InboxView({ initialItems }: { initialItems: Item[] }) {
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState<"All" | "Urgent" | "Deploys" | "Ads" | "Outreach">("All");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const router = useRouter();

  const pending = useMemo(() => items.filter((item) => item.status === "pending"), [items]);
  const resolved = useMemo(() => items.filter((item) => item.status !== "pending"), [items]);

  const filteredPending = useMemo(() => {
    if (filter === "All") return pending;
    if (filter === "Urgent") return pending.filter((item) => item.risk === "high");
    return pending.filter((item) => actionBucket(item.action_type) === filter);
  }, [pending, filter]);

  const urgentCount = pending.filter((item) => item.risk === "high").length;
  const approvedToday = items.filter((item) => {
    if (item.status !== "approved" || !item.decided_at) return false;
    const now = new Date();
    const decided = new Date(item.decided_at);
    return now.toDateString() === decided.toDateString();
  }).length;
  const totalWeek = items.filter((item) => {
    const ref = item.decided_at ? new Date(item.decided_at) : new Date(item.created_at);
    return Date.now() - ref.getTime() <= 7 * 86400000;
  }).length;

  async function parseResponseJson(response: Response) {
    const raw = await response.text();
    if (!raw.trim()) return null;
    try {
      return JSON.parse(raw) as DecisionResponse;
    } catch {
      return null;
    }
  }

  function requiresRevisionGuidance(item: Item) {
    return item.action_type.startsWith("phase") && item.action_type.endsWith("_review");
  }

  async function decide(item: Item, decision: Decision, guidance?: string) {
    setLoadingId(item.id);
    setError(null);
    try {
      const res = await fetch(`/api/inbox/${item.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, version: item.version, guidance }),
      });
      const json = await parseResponseJson(res);
      if (!res.ok) {
        const message = typeof json?.error === "string" ? json.error : "Decision failed";
        throw new Error(message);
      }

      setItems((prev) =>
        prev.map((row) =>
          row.id === item.id
            ? {
                ...row,
                status: decision,
                version: typeof json?.version === "number" ? json.version : row.version + 1,
                decided_at: new Date().toISOString(),
              }
            : row,
        ),
      );

      if (decision === "revised" && json?.phase0RelaunchRequired) {
        const launchRes = await fetch(`/api/projects/${item.project_id}/launch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            revisionGuidance: guidance ?? "",
            forceNewApproval: true,
          }),
        });
        const launchJson = await parseResponseJson(launchRes);
        if (!launchRes.ok) {
          throw new Error(
            `Revision saved, but relaunch failed: ${
              typeof launchJson?.error === "string" ? launchJson.error : `HTTP ${launchRes.status}`
            }`,
          );
        }
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Decision failed");
    } finally {
      setLoadingId(null);
    }
  }

  async function requestRevision(item: Item) {
    if (requiresRevisionGuidance(item)) {
      const guidance = window.prompt("What guidance should the CEO agent use for this retry?");
      if (guidance === null) return;
      if (guidance.trim().length < 8) {
        setError("Revision guidance must be at least 8 characters.");
        return;
      }
      await decide(item, "revised", guidance.trim());
      return;
    }

    await decide(item, "revised");
  }

  return (
    <>
      <StudioNav active="inbox" pendingCount={pending.length} />

      <div className="page">
        {error && <div className="alert error">{error}</div>}

        <div className="page-header">
          <div className="page-title">
            📥 Approval Inbox <span className="count-badge">{pending.length} pending</span>
          </div>
          <div className="filter-bar">
            {(["All", "Urgent", "Deploys", "Ads", "Outreach"] as const).map((bucket) => (
              <button key={bucket} className={`filter-btn ${filter === bucket ? "active" : ""}`} onClick={() => setFilter(bucket)}>
                {bucket}
              </button>
            ))}
          </div>
        </div>

        <div className="stats">
          <div className="stat"><div className="stat-num urgent">{urgentCount}</div><div className="stat-label">Urgent</div></div>
          <div className="stat"><div className="stat-num pending">{pending.length}</div><div className="stat-label">Pending</div></div>
          <div className="stat"><div className="stat-num done">{approvedToday}</div><div className="stat-label">Approved Today</div></div>
          <div className="stat"><div className="stat-num total">{totalWeek}</div><div className="stat-label">Total This Week</div></div>
        </div>

        <div className="section-label"><div className="dot urgent" /> Requires Immediate Review</div>
        <div className="card-list">
          {filteredPending.filter((item) => item.risk === "high").map((item) => {
            const synopsis = parseSynopsis(item.payload);
            return (
              <div key={item.id} className={`approval-card ${pendingClass(item.risk)}`}>
                <div className="card-top">
                  <div className="card-project">
                    <div className="project-icon">🚀</div>
                    <div><div className="project-name">{item.project_name} · Phase {item.phase}</div></div>
                  </div>
                  <span className={`risk-badge ${riskClass(item.risk)}`}>{item.risk} risk</span>
                </div>
                <div className="card-title">{item.title}</div>
                <div className="card-desc">{item.description}</div>
                <div className="card-meta">
                  <span>🤖 {item.action_type}</span>
                  <span>⏱ {relativeTime(item.created_at)}</span>
                  <span>🔐 v{item.version}</span>
                </div>
                <div className="card-actions">
                  <button className="btn btn-approve" disabled={loadingId === item.id} onClick={() => decide(item, "approved")}>✓ Approve</button>
                  <Link href={`/projects/${item.project_id}/packet`} className="btn btn-preview">View Packet</Link>
                  <button className="btn btn-details" onClick={() => setExpanded(expanded === item.id ? null : item.id)}>View Details</button>
                  <button className="btn btn-deny" disabled={loadingId === item.id} onClick={() => decide(item, "denied")}>✕ Deny</button>
                </div>
                <div className={`detail-panel ${expanded === item.id ? "show" : ""}`}>
                  <div className="detail-row"><span className="detail-label">Action Type</span><span className="detail-value">{item.action_type}</span></div>
                  <div className="detail-row"><span className="detail-label">Status</span><span className="detail-value">{item.status}</span></div>
                  {synopsis && (
                    <div className="synopsis-mini">
                      <strong>CEO Synopsis:</strong> {synopsis.rationale.join(" ")}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {filteredPending.filter((item) => item.risk === "high").length === 0 && (
            <div className="history-card">No urgent approvals.</div>
          )}
        </div>

        <div className="section-label"><div className="dot pending" /> Pending Review</div>
        <div className="card-list">
          {filteredPending.filter((item) => item.risk !== "high").map((item) => (
            <div key={item.id} className={`approval-card ${pendingClass(item.risk)}`}>
              <div className="card-top">
                <div className="card-project">
                  <div className="project-icon">📦</div>
                  <div><div className="project-name">{item.project_name} · Phase {item.phase}</div></div>
                </div>
                <span className={`risk-badge ${riskClass(item.risk)}`}>{item.risk} risk</span>
              </div>
              <div className="card-title">{item.title}</div>
              <div className="card-desc">{item.description}</div>
              <div className="card-meta">
                <span>🤖 {item.action_type}</span>
                <span>⏱ {relativeTime(item.created_at)}</span>
                <span>🔐 v{item.version}</span>
              </div>
              <div className="card-actions">
                <button className="btn btn-approve" disabled={loadingId === item.id} onClick={() => decide(item, "approved")}>✓ Approve</button>
                <button className="btn btn-preview" disabled={loadingId === item.id} onClick={() => requestRevision(item)}>Request Revision</button>
                <Link href={`/projects/${item.project_id}/packet`} className="btn btn-details">View Details</Link>
                <button className="btn btn-deny" disabled={loadingId === item.id} onClick={() => decide(item, "denied")}>✕ Deny</button>
              </div>
            </div>
          ))}
          {filteredPending.filter((item) => item.risk !== "high").length === 0 && (
            <div className="history-card">No pending items for selected filter.</div>
          )}
        </div>

        <div className="section-label"><div className="dot muted" /> Recently Resolved</div>
        <div className="card-list">
          {resolved.slice(0, 10).map((item) => (
            <div key={item.id} className="history-card">
              <div className="card-top">
                <div className="card-project">
                  <div className="project-icon">📁</div>
                  <div><div className="project-name">{item.project_name} · Phase {item.phase}</div></div>
                </div>
              </div>
              <div className="card-title">
                {item.title}
                <span className={`resolution ${item.status === "approved" ? "approved" : "denied"}`}>{item.status}</span>
              </div>
              <div className="card-meta">
                <span>{item.decided_at ? relativeTime(item.decided_at) : relativeTime(item.created_at)}</span>
                <span>Risk: {item.risk}</span>
              </div>
            </div>
          ))}
          {!resolved.length && <div className="history-card">No resolved items yet.</div>}
        </div>
      </div>
    </>
  );
}
