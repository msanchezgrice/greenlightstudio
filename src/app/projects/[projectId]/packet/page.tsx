import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { createServiceSupabase } from "@/lib/supabase";
import { packetSchema } from "@/types/domain";
import { PacketActions } from "@/components/packet-actions";
import { PacketDecisionBar } from "@/components/packet-decision-bar";
import { ProjectChatPane } from "@/components/project-chat-pane";

type LaunchTask = {
  description: string;
  status: "queued" | "running" | "completed" | "failed";
  detail: string | null;
  created_at: string;
};

function recommendationClass(rec: string) {
  if (rec === "greenlight") return "green";
  if (rec === "revise") return "yellow";
  return "red";
}

function latestPhase0Attempt(tasks: LaunchTask[]) {
  const ordered = [...tasks]
    .map((task) => ({ ...task, createdAtMs: Date.parse(task.created_at) }))
    .filter((task) => Number.isFinite(task.createdAtMs))
    .sort((left, right) => left.createdAtMs - right.createdAtMs);

  const initStarts = ordered
    .filter((task) => task.description === "phase0_init")
    .map((task) => task.createdAtMs);
  const attemptStart = initStarts.length ? Math.max(...initStarts) : null;
  if (attemptStart === null) return ordered;

  const threshold = attemptStart - 5_000;
  return ordered.filter((task) => task.createdAtMs >= threshold);
}

export default async function PacketPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return null;

  const { projectId } = await params;
  const db = createServiceSupabase();

  const { data: project } = await db
    .from("projects")
    .select("owner_clerk_id,name,phase,domain,created_at")
    .eq("id", projectId)
    .single();
  if (!project || project.owner_clerk_id !== userId) return <main className="page"><p>Forbidden</p></main>;

  const [{ data: packetRow }, { data: approvalRow }, { data: taskRows }] = await Promise.all([
    db
      .from("phase_packets")
      .select("packet, confidence, created_at")
      .eq("project_id", projectId)
      .eq("phase", 0)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("approval_queue")
      .select("id,version,status")
      .eq("project_id", projectId)
      .eq("phase", 0)
      .eq("action_type", "phase0_packet_review")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("tasks")
      .select("description,status,detail,created_at")
      .eq("project_id", projectId)
      .in("description", ["phase0_init", "phase0_research", "phase0_synthesis", "phase0_complete", "phase0_failed"])
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const phase0Tasks = latestPhase0Attempt((taskRows ?? []) as LaunchTask[]);
  const latestFailure = [...phase0Tasks].reverse().find((task) => task.status === "failed");
  const latestRunning = [...phase0Tasks].reverse().find(
    (task) => ["phase0_init", "phase0_research", "phase0_synthesis"].includes(task.description) && task.status === "running",
  );
  const latestComplete = [...phase0Tasks].reverse().find((task) => task.description === "phase0_complete" && task.status === "completed");

  if (!packetRow) {
    return (
      <>
        <nav className="nav">
          <div className="nav-left">
            <div className="logo">▲ <span>Greenlight</span></div>
            <div className="breadcrumb">
              <Link href="/board">Board</Link> / <Link href={`/projects/${projectId}`}>{project.name}</Link> / <strong>Phase 0 Packet</strong>
            </div>
          </div>
        </nav>

        <main className="page packet-page">
          <section className="studio-card">
            <h1 className="page-title">Phase 0 Packet</h1>
            <p className="meta-line">The packet is not available yet for this project.</p>

            {latestFailure && (
              <div className="alert error" style={{ marginTop: 12 }}>
                Latest launch failure: {latestFailure.detail ?? latestFailure.description}
              </div>
            )}

            {latestRunning && !latestFailure && (
              <div className="warning-state" style={{ marginTop: 12 }}>
                <p className="warning-text">
                  Launch is still running at step: {latestRunning.description}
                  {latestRunning.detail ? ` — ${latestRunning.detail}` : ""}
                </p>
              </div>
            )}

            {!latestFailure && !latestRunning && !latestComplete && (
              <p className="meta-line" style={{ marginTop: 12 }}>
                No phase 0 launch task was detected yet.
              </p>
            )}

            <div className="card-actions" style={{ marginTop: 14 }}>
              <Link href={`/projects/${projectId}`} className="btn btn-details">
                Open Project
              </Link>
              <Link href="/tasks" className="btn btn-preview">
                View Tasks
              </Link>
              <Link href="/onboarding?new=1" className="btn btn-details">
                New Project
              </Link>
            </div>
          </section>
        </main>
      </>
    );
  }

  const parsed = packetSchema.safeParse(packetRow.packet);
  if (!parsed.success) {
    return (
      <main className="page">
        <h1 className="page-title">Phase 0 Packet</h1>
        <p className="meta-line">Packet failed schema validation and cannot be rendered safely.</p>
      </main>
    );
  }

  const packet = parsed.data;
  const confidenceBreakdown = packet.confidence_breakdown;

  return (
    <>
      <nav className="nav">
        <div className="nav-left">
          <div className="logo">▲ <span>Greenlight</span></div>
          <div className="breadcrumb">
            <Link href="/board">Board</Link> / <Link href="/inbox">Inbox</Link> / <strong>Phase 0 Packet</strong>
          </div>
        </div>
        <div className="nav-right">
          <PacketActions
            exportUrl={`/api/projects/${projectId}/packet/export`}
            shareApiUrl={`/api/projects/${projectId}/packet/share`}
          />
        </div>
      </nav>

      <main className="page packet-page">
        <div className="packet-header">
          <div className="ph-top">
            <div className="ph-project">
              <div className="ph-icon">📦</div>
              <div>
                <div className="ph-name">{project.name}</div>
                <div className="ph-tagline">{packet.tagline}</div>
              </div>
            </div>
            <div className="ph-phase">Phase 0 Packet</div>
          </div>
          <div className="ph-pitch">{packet.elevator_pitch}</div>
          <div className="ph-meta">
            <span>🤖 Generated by CEO Agent</span>
            <span>📅 {new Date(packetRow.created_at).toLocaleDateString()}</span>
            <span>📍 Domain: {project.domain ?? "none"}</span>
            <span>🔄 Phase: {project.phase}</span>
          </div>
        </div>

        <section className="confidence">
          <div className="conf-top">
            <div>
              <div className="conf-title">Confidence Score</div>
              <div className="conf-label">Overall assessment</div>
            </div>
            <div>
              <div className="conf-score">{packetRow.confidence}</div>
              <div className="conf-label">out of 100</div>
            </div>
          </div>

          {confidenceBreakdown ? (
            <div className="conf-bars">
              {([
                ["Market", confidenceBreakdown.market],
                ["Competition", confidenceBreakdown.competition],
                ["Feasibility", confidenceBreakdown.feasibility],
                ["Timing", confidenceBreakdown.timing],
              ] as const).map(([label, value]) => (
                <div className="conf-bar" key={label}>
                  <div className="conf-bar-label">{label}</div>
                  <div className="conf-bar-track">
                    <div className="conf-bar-fill" style={{ width: `${value}%` }} />
                  </div>
                  <div className="conf-bar-val">{value}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="meta-line">Confidence breakdown missing in packet payload.</p>
          )}
        </section>

        <section className="section">
          <div className="section-header">
            <div className="section-title"><span className="icon">🔍</span> Existing Presence Check</div>
          </div>
          {packet.existing_presence.map((presence, index) => (
            <div className="presence-card" key={`${presence.domain}-${index}`}>
              <div className="presence-left">
                <span className={`presence-status ${presence.status === "live" ? "status-live" : "status-parked"}`}>{presence.status}</span>
                <div>
                  <div className="presence-domain">{presence.domain}</div>
                  <div className="presence-detail">{presence.detail}</div>
                </div>
              </div>
              <div className="meta-line">{new Date(presence.scanned_at).toLocaleString()}</div>
            </div>
          ))}
        </section>

        <section className="section">
          <div className="section-header">
            <div className="section-title"><span className="icon">⚔️</span> Competitor Analysis</div>
            <span className="tag tag-blue">{packet.competitor_analysis.length} found</span>
          </div>
          <table className="comp-table">
            <thead>
              <tr><th>Competitor</th><th>Positioning</th><th>Gap</th><th>Pricing</th></tr>
            </thead>
            <tbody>
              {packet.competitor_analysis.map((competitor) => (
                <tr key={competitor.name}>
                  <td className="comp-name">{competitor.name}</td>
                  <td>{competitor.positioning}</td>
                  <td><span className="gap-badge">{competitor.gap}</span></td>
                  <td>{competitor.pricing}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="section">
          <div className="section-header">
            <div className="section-title"><span className="icon">📊</span> Market Sizing</div>
          </div>
          <div className="market-grid">
            <div className="market-card"><div className="market-label">TAM</div><div className="market-value">{packet.market_sizing.tam}</div></div>
            <div className="market-card"><div className="market-label">SAM</div><div className="market-value">{packet.market_sizing.sam}</div></div>
            <div className="market-card"><div className="market-label">SOM</div><div className="market-value">{packet.market_sizing.som}</div></div>
          </div>
        </section>

        <section className="section">
          <div className="section-header">
            <div className="section-title"><span className="icon">🎯</span> Target Persona</div>
          </div>
          <div className="persona">
            <div className="persona-avatar">👤</div>
            <div>
              <div className="persona-name">{packet.target_persona.name}</div>
              <div className="persona-desc">{packet.target_persona.description}</div>
              <div className="pain-points">
                {packet.target_persona.pain_points.map((pain) => <span className="pain" key={pain}>{pain}</span>)}
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-header">
            <div className="section-title"><span className="icon">🧱</span> MVP Scope</div>
          </div>
          <div className="scope-grid">
            <div className="scope-col">
              <h4>In Scope</h4>
              {packet.mvp_scope.in_scope.map((item) => <div className="scope-item" key={item}><span className="check">✓</span>{item}</div>)}
            </div>
            <div className="scope-col">
              <h4>Deferred</h4>
              {packet.mvp_scope.deferred.map((item) => <div className="scope-item" key={item}><span className="defer">○</span>{item}</div>)}
            </div>
          </div>
        </section>

        <section className={`recommendation ${recommendationClass(packet.recommendation)}`}>
          <div className="rec-header">
            <div className="rec-verdict">Recommendation: {packet.recommendation.toUpperCase()}</div>
          </div>
          <div className="rec-body">
            {packet.reasoning_synopsis.rationale.join(" ")}
          </div>
          <div className="rec-clearer">
            <h4>Key Risks</h4>
            <p>{packet.reasoning_synopsis.risks.join(" ")}</p>
          </div>
        </section>

        <section className="synopsis">
          <div className="synopsis-title">🧠 Reasoning Synopsis</div>
          <div className="syn-grid">
            <div className="syn-item"><div className="syn-label">Decision</div><div className="syn-value">{packet.reasoning_synopsis.decision}</div></div>
            <div className="syn-item"><div className="syn-label">Confidence</div><div className="syn-value">{packet.reasoning_synopsis.confidence}</div></div>
            <div className="syn-item"><div className="syn-label">Next Actions</div><div className="syn-value">{packet.reasoning_synopsis.next_actions.join(", ")}</div></div>
            <div className="syn-item"><div className="syn-label">Evidence</div><div className="syn-value">{packet.reasoning_synopsis.evidence.map((entry) => `${entry.claim} (${entry.source})`).join("; ")}</div></div>
          </div>
        </section>

        <ProjectChatPane projectId={projectId} title="CEO Chat Pane" />
      </main>

      <PacketDecisionBar
        projectId={projectId}
        approvalId={(approvalRow?.id as string | undefined) ?? null}
        approvalVersion={typeof approvalRow?.version === "number" ? approvalRow.version : null}
        approvalStatus={
          typeof approvalRow?.status === "string" &&
          ["pending", "approved", "denied", "revised"].includes(approvalRow.status)
            ? (approvalRow.status as "pending" | "approved" | "denied" | "revised")
            : null
        }
      />
    </>
  );
}
