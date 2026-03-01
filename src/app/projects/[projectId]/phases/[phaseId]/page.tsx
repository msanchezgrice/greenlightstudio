import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { StudioNav } from "@/components/studio-nav";
import { ProjectChatPane } from "@/components/project-chat-pane";
import { RetryTaskButton } from "@/components/retry-task-button";
import { AgentActivityIndicator } from "@/components/agent-activity";
import { AgentProcessPanel } from "@/components/agent-process-panel";
import { getOwnedProjects, getPendingApprovalsByProject } from "@/lib/studio";
import { PHASES, phaseStatus, getAgentProfile, humanizeTaskDescription, taskOutputLink, type PhaseId } from "@/lib/phases";
import { parsePhasePacket, type PhasePacket } from "@/types/phase-packets";

type ProjectRow = {
  id: string;
  name: string;
  domain: string | null;
  phase: number;
  runtime_mode: "shared" | "attached";
  updated_at: string;
};

type ApprovalRow = {
  id: string;
  title: string;
  status: "pending" | "approved" | "denied" | "revised";
  risk: "high" | "medium" | "low";
  created_at: string;
};

type TaskRow = {
  id: string;
  description: string;
  agent: string;
  status: "queued" | "running" | "completed" | "failed";
  detail: string | null;
  created_at: string;
};

type PacketRow = {
  phase: number;
  confidence: number;
  packet: unknown;
  created_at: string;
};

function statusClass(status: string) {
  if (status === "completed" || status === "approved") return "good";
  if (status === "running" || status === "queued" || status === "pending" || status === "revised") return "warn";
  if (status === "failed" || status === "denied") return "bad";
  return "tone-muted";
}

function riskClass(risk: ApprovalRow["risk"]) {
  if (risk === "high") return "bad";
  if (risk === "medium") return "warn";
  return "good";
}

function phaseLabel(phase: number) {
  if (phase === 0) return "Phase 0";
  if (phase === 1) return "Phase 1";
  if (phase === 2) return "Phase 2";
  return "Phase 3";
}

function safeParsePacket(phase: PhaseId, payload: unknown): { packet: PhasePacket | null; error: string | null } {
  try {
    return { packet: parsePhasePacket(phase, payload), error: null };
  } catch (error) {
    return { packet: null, error: error instanceof Error ? error.message : "Invalid packet payload" };
  }
}

function landingVariantIndex(metadata: Record<string, unknown> | null | undefined) {
  const value = metadata?.variant_index;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  return null;
}

export default async function ProjectPhaseWorkspacePage({
  params,
}: {
  params: Promise<{ projectId: string; phaseId: string }>;
}) {
  const { userId } = await auth();
  if (!userId) return null;

  const { projectId, phaseId } = await params;
  const phase = Number(phaseId);
  if (!Number.isInteger(phase) || phase < 0 || phase > 3) {
    return (
      <main className="page studio-page">
        <section className="studio-card">
          <h2>Invalid phase</h2>
          <p className="meta-line">Phase must be 0, 1, 2, or 3.</p>
        </section>
      </main>
    );
  }

  const db = createServiceSupabase();
  const projects = await getOwnedProjects(userId);
  const projectIds = projects.map((entry) => entry.id);
  const { total: pendingCount } = await getPendingApprovalsByProject(projectIds);

  const [projectQuery, packetQuery, approvalsQuery, tasksQuery, deploymentQuery, assetsQuery] = await Promise.all([
    withRetry(() =>
      db
        .from("projects")
        .select("id,name,domain,phase,runtime_mode,updated_at,live_url")
        .eq("id", projectId)
        .eq("owner_clerk_id", userId)
        .maybeSingle(),
    ),
    withRetry(() =>
      db
        .from("phase_packets")
        .select("phase,confidence,packet,created_at")
        .eq("project_id", projectId)
        .eq("phase", phase)
        .maybeSingle(),
    ),
    withRetry(() =>
      db
        .from("approval_queue")
        .select("id,title,status,risk,created_at")
        .eq("project_id", projectId)
        .eq("phase", phase)
        .order("created_at", { ascending: false })
        .limit(20),
    ),
    withRetry(() =>
      db
        .from("tasks")
        .select("id,description,agent,status,detail,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(200),
    ),
    withRetry(() =>
      db
        .from("project_deployments")
        .select("project_id,phase,status,metadata,deployed_at")
        .eq("project_id", projectId)
        .maybeSingle(),
    ),
    withRetry(() =>
      db
        .from("project_assets")
        .select("id,kind,storage_path,filename,mime_type,metadata,created_at")
        .eq("project_id", projectId)
        .eq("phase", phase)
        .eq("status", "uploaded")
        .order("created_at", { ascending: false })
        .limit(50),
    ),
  ]);

  if (projectQuery.error || !projectQuery.data) {
    return (
      <>
        <StudioNav active="board" pendingCount={pendingCount} />
        <main className="page studio-page">
          <section className="studio-card">
            <h2>Project not found</h2>
            <p className="meta-line">This project does not exist or is not accessible.</p>
          </section>
        </main>
      </>
    );
  }

  const project = projectQuery.data as ProjectRow & { live_url?: string };
  const packetRow = (packetQuery.data as PacketRow | null) ?? null;
  const approvals = (approvalsQuery.data ?? []) as ApprovalRow[];
  const allTasks = (tasksQuery.data ?? []) as TaskRow[];
  const phaseTasks = allTasks.filter((task) => task.description.startsWith(`phase${phase}_`)).slice(0, 30);
  const deployment = deploymentQuery.data as { project_id: string; phase: number; status: string; metadata: Record<string, unknown>; deployed_at: string } | null;
  const assets = (assetsQuery.data ?? []) as Array<{
    id: string;
    kind: string;
    storage_path: string;
    filename: string;
    mime_type: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
  }>;
  const brandAssets = assets.filter((a) => a.metadata?.brand_asset === true);
  const brandBriefHtmlAsset = assets.find((a) => a.filename === "brand-brief.html" || a.metadata?.brand_brief === true);
  const brandBriefPptxAsset = assets.find((a) => a.filename === "brand-brief.pptx" || a.metadata?.brand_brief_pptx === true);
  const landingVariants = assets
    .filter((a) => a.kind === "landing_html")
    .sort((a, b) => {
      const aIndex = landingVariantIndex(a.metadata) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = landingVariantIndex(b.metadata) ?? Number.MAX_SAFE_INTEGER;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  const landingAsset = landingVariants.find((a) => a.metadata?.selected_variant === true) ?? landingVariants[0];
  const previewUrl = deployment ? `/launch/${projectId}` : (landingAsset ? `/launch/${projectId}` : null);
  const rawLiveUrl = project.live_url;
  const liveUrl = rawLiveUrl && !rawLiveUrl.includes("localhost") ? rawLiveUrl : previewUrl;
  const landingVariantLinks = landingVariants.map((variant) => {
    const index = landingVariantIndex(variant.metadata);
    const score = typeof variant.metadata?.design_score === "number" ? variant.metadata.design_score : null;
    const isSelected = variant.metadata?.selected_variant === true;
    return {
      label: `${isSelected ? "Selected" : "Landing"} Variant ${index ?? "?"}${score !== null ? ` · ${score}/100` : ""}`,
      href: `/api/projects/${projectId}/assets/${variant.id}/preview`,
      external: true,
    };
  });

  const currentPhaseDefinition = PHASES.find((entry) => entry.id === phase) ?? PHASES[0];
  const status = phaseStatus(project.phase, phase);
  const gate = approvals[0] ?? null;
  const packetParse = packetRow ? safeParsePacket(phase as PhaseId, packetRow.packet) : { packet: null, error: null };

  return (
    <>
      <StudioNav active="board" pendingCount={pendingCount} />
      <main className="page studio-page">
        <div className="page-header">
          <div>
            <h1 className="page-title">
              {project.name} · {phaseLabel(phase)} Workspace
            </h1>
            <p className="meta-line">
              {currentPhaseDefinition.title} · {status} · updated {new Date(project.updated_at).toLocaleString()}
            </p>
          </div>
          <div className="table-actions">
            <Link href={`/projects/${projectId}/phases`} className="btn btn-details">
              All Phases
            </Link>
            {phase === 0 &&
              (packetRow ? (
                <Link href={`/projects/${projectId}/packet`} className="btn btn-preview">
                  Open Phase 0 Packet
                </Link>
              ) : (
                <span className="btn btn-preview btn-disabled" aria-disabled="true">
                  Open Phase 0 Packet
                </span>
              ))}
            <Link href="/inbox" className="btn btn-details">
              Inbox
            </Link>
          </div>
        </div>

        <section className="studio-card project-meta-grid">
          <div>
            <div className="metric-label">Current Project Phase</div>
            <div className="metric-value">{project.phase}</div>
          </div>
          <div>
            <div className="metric-label">Workspace Status</div>
            <div className={`metric-value ${statusClass(status)}`}>{status}</div>
          </div>
          <div>
            <div className="metric-label">Runtime</div>
            <div className="metric-value">{project.runtime_mode}</div>
          </div>
          <div>
            <div className="metric-label">Domain</div>
            <div className="metric-value">{project.domain ?? "None"}</div>
          </div>
          <div>
            <div className="metric-label">Gate Status</div>
            <div className={`metric-value ${statusClass(gate?.status ?? "pending")}`}>{gate?.status ?? "not created"}</div>
          </div>
          <div>
            <div className="metric-label">Packet Confidence</div>
            <div className="metric-value">{packetRow ? `${packetRow.confidence}/100` : "--"}</div>
          </div>
        </section>

        <section className="studio-card">
          <h2>Deliverables</h2>
          <div className="phase-deliverables">
            {currentPhaseDefinition.deliverables.map((deliverable) => (
              <span key={deliverable} className="deliverable-chip">
                {deliverable}
              </span>
            ))}
          </div>
        </section>

        {!packetRow && (
          <section className="studio-card">
            <h2>Phase Packet</h2>
            <p className="meta-line">No phase packet generated yet for this phase.</p>
          </section>
        )}

        {packetRow && packetParse.error && (
          <section className="studio-card">
            <h2>Phase Packet</h2>
            <p className="meta-line">Packet exists but failed validation: {packetParse.error}</p>
          </section>
        )}

        {phase === 1 && packetParse.packet && "landing_page" in packetParse.packet && (
          <>
            <section className="studio-card">
              <h2>Validation Summary</h2>
              <p style={{ color: "var(--text)", lineHeight: 1.6, fontSize: 14, margin: 0 }}>
                {packetParse.packet.summary}
              </p>
            </section>

            {/* Landing Page — live preview + link */}
            <section className="studio-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h2 style={{ margin: 0 }}>Landing Page</h2>
                <div className="table-actions">
                  {liveUrl && (
                    <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">
                      Open Live Page
                    </a>
                  )}
                  {landingVariants.map((variant) => {
                    const index = landingVariantIndex(variant.metadata);
                    const score = typeof variant.metadata?.design_score === "number" ? variant.metadata.design_score : null;
                    const isSelected = variant.metadata?.selected_variant === true;
                    return (
                      <a
                        key={variant.id}
                        href={`/api/projects/${projectId}/assets/${variant.id}/preview`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={isSelected ? "btn btn-approve btn-sm" : "btn btn-details btn-sm"}
                      >
                        {isSelected ? "Selected" : "Variant"} {index ?? "?"}
                        {score !== null ? ` · ${score}/100` : ""}
                      </a>
                    );
                  })}
                </div>
              </div>
              {previewUrl ? (
                <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)", background: "#000" }}>
                  <iframe
                    src={previewUrl}
                    title="Landing Page Preview"
                    style={{ width: "100%", height: 480, border: "none", display: "block" }}
                    sandbox="allow-scripts allow-forms allow-same-origin"
                  />
                </div>
              ) : (
                <p className="meta-line">Landing page not yet deployed.</p>
              )}
              <div className="project-metrics" style={{ marginTop: 16 }}>
                <div>
                  <div className="metric-label">Headline</div>
                  <div className="metric-value">{packetParse.packet.landing_page.headline}</div>
                </div>
                <div>
                  <div className="metric-label">Primary CTA</div>
                  <div className="metric-value">{packetParse.packet.landing_page.primary_cta}</div>
                </div>
                <div>
                  <div className="metric-label">Target CVR</div>
                  <div className="metric-value">{packetParse.packet.waitlist.target_conversion_rate}</div>
                </div>
                <div>
                  <div className="metric-label">Waitlist Fields</div>
                  <div className="metric-value">{packetParse.packet.waitlist.form_fields.join(", ")}</div>
                </div>
              </div>
            </section>

            {/* Brand Kit — asset gallery + palette */}
            <section className="studio-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h2 style={{ margin: 0 }}>Brand Kit</h2>
                <div className="table-actions">
                  {brandBriefHtmlAsset && (
                    <a
                      href={`/api/projects/${projectId}/assets/${brandBriefHtmlAsset.id}/preview`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-details btn-sm"
                    >
                      Open Brand Brief
                    </a>
                  )}
                  {brandBriefPptxAsset && (
                    <a
                      href={`/api/projects/${projectId}/assets/${brandBriefPptxAsset.id}/preview`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-details btn-sm"
                    >
                      Download Brand Deck (PPTX)
                    </a>
                  )}
                </div>
              </div>
              {brandAssets.length > 0 && (
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 20 }}>
                  {brandAssets.map((asset) => {
                    const label = (asset.metadata?.label as string) ?? asset.filename;
                    return (
                      <div key={asset.id} style={{ textAlign: "center" }}>
                        <div
                          style={{
                            width: 100,
                            height: 100,
                            borderRadius: 16,
                            border: "1px solid var(--border)",
                            background: "var(--surface, rgba(255,255,255,.03))",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                            marginBottom: 8,
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/projects/${projectId}/assets/${asset.id}/preview`}
                            alt={label}
                            style={{ width: "80%", height: "80%", objectFit: "contain" }}
                          />
                        </div>
                        <div className="meta-line" style={{ fontSize: 12 }}>{label}</div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="project-metrics">
                <div>
                  <div className="metric-label">Voice</div>
                  <div className="metric-value">{packetParse.packet.brand_kit.voice}</div>
                </div>
                <div>
                  <div className="metric-label">Color Palette</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    {packetParse.packet.brand_kit.color_palette.map((color) => (
                      <div
                        key={color}
                        title={color}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          background: color.startsWith("#") ? color : "var(--card2)",
                          border: "1px solid rgba(255,255,255,.15)",
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <div className="metric-label">Font Pairing</div>
                  <div className="metric-value">{packetParse.packet.brand_kit.font_pairing}</div>
                </div>
                <div>
                  <div className="metric-label">Logo Prompt</div>
                  <div className="metric-value" style={{ fontSize: 13 }}>{packetParse.packet.brand_kit.logo_prompt}</div>
                </div>
              </div>
            </section>

            {/* Email Drip Sequence */}
            <section className="studio-card">
              <h2>Welcome Email Sequence</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
                {packetParse.packet.email_sequence.emails.map((email, i) => (
                  <div
                    key={`${email.day}-${i}`}
                    style={{
                      display: "flex",
                      gap: 16,
                      alignItems: "flex-start",
                      padding: "16px 20px",
                      background: "var(--surface, rgba(255,255,255,.03))",
                      border: "1px solid var(--border, rgba(255,255,255,.08))",
                      borderRadius: 12,
                    }}
                  >
                    <div
                      style={{
                        minWidth: 56,
                        padding: "4px 10px",
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        textAlign: "center",
                        background: "rgba(59,130,246,.12)",
                        color: "#60A5FA",
                      }}
                    >
                      {email.day}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: 2 }}>{email.subject}</div>
                      <div className="meta-line">{email.goal}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Analytics + Social Strategy */}
            <div className="phase-two-col">
              <section className="studio-card">
                <h2>Analytics</h2>
                <div className="metric-label">Provider</div>
                <div className="metric-value" style={{ marginBottom: 8 }}>{packetParse.packet.analytics.provider}</div>
                <div className="metric-label">Key Events</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {packetParse.packet.analytics.events.map((e) => (
                    <span key={e} className="deliverable-chip">{e}</span>
                  ))}
                </div>
                <div className="metric-label">Dashboard Views</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {packetParse.packet.analytics.dashboard_views.map((v) => (
                    <span key={v} className="deliverable-chip">{v}</span>
                  ))}
                </div>
              </section>

              <section className="studio-card">
                <h2>Social Strategy</h2>
                <div className="metric-label">Channels</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {packetParse.packet.social_strategy.channels.map((ch) => (
                    <span key={ch} className="pill blue">{ch}</span>
                  ))}
                </div>
                <div className="metric-label">Posting Cadence</div>
                <div className="metric-value" style={{ marginBottom: 8 }}>{packetParse.packet.social_strategy.posting_cadence}</div>
                <div className="metric-label">Content Pillars</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {packetParse.packet.social_strategy.content_pillars.map((p) => (
                    <span key={p} className="deliverable-chip">{p}</span>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}

        {phase === 2 && packetParse.packet && "distribution_strategy" in packetParse.packet && (
          <>
            <section className="studio-card">
              <h2>Distribution Summary</h2>
              <p className="meta-line">{packetParse.packet.summary}</p>
            </section>

            <section className="studio-card">
              <h2>Channel Plan</h2>
              <div className="table-shell">
                <table className="studio-table compact">
                  <thead>
                    <tr>
                      <th>Channel</th>
                      <th>Objective</th>
                      <th>Weekly Budget</th>
                    </tr>
                  </thead>
                  <tbody>
                    {packetParse.packet.distribution_strategy.channel_plan.map((row) => (
                      <tr key={`${row.channel}-${row.objective}`}>
                        <td>{row.channel}</td>
                        <td>{row.objective}</td>
                        <td>{row.weekly_budget}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="studio-card">
              <h2>Paid + Outreach Controls</h2>
              <div className="project-metrics">
                <div>
                  <div className="metric-label">Paid Acquisition</div>
                  <div className={`metric-value ${packetParse.packet.paid_acquisition.enabled ? "good" : "tone-muted"}`}>
                    {packetParse.packet.paid_acquisition.enabled ? "Enabled" : "Disabled"}
                  </div>
                </div>
                <div>
                  <div className="metric-label">Budget Cap / Day</div>
                  <div className="metric-value">${packetParse.packet.paid_acquisition.budget_cap_per_day}</div>
                </div>
                <div>
                  <div className="metric-label">Daily Outreach Cap</div>
                  <div className="metric-value">{packetParse.packet.outreach.daily_send_cap}</div>
                </div>
              </div>
              <p className="meta-line" style={{ marginTop: 10 }}>
                Kill switch: {packetParse.packet.paid_acquisition.kill_switch}
              </p>
              <p className="meta-line">Guardrails: {packetParse.packet.guardrails.join(" · ")}</p>
            </section>
          </>
        )}

        {phase === 3 && packetParse.packet && "architecture_review" in packetParse.packet && (
          <>
            <section className="studio-card">
              <h2>Go-Live Summary</h2>
              <p className="meta-line">{packetParse.packet.summary}</p>
            </section>

            <section className="studio-card">
              <h2>Architecture + Merge Policy</h2>
              <div className="project-metrics">
                <div>
                  <div className="metric-label">Runtime Mode</div>
                  <div className="metric-value">{packetParse.packet.architecture_review.runtime_mode}</div>
                </div>
                <div>
                  <div className="metric-label">Protected Branch</div>
                  <div className="metric-value">{packetParse.packet.merge_policy.protected_branch}</div>
                </div>
                <div>
                  <div className="metric-label">Approvals Required</div>
                  <div className="metric-value">{packetParse.packet.merge_policy.approvals_required}</div>
                </div>
              </div>
              <p className="meta-line" style={{ marginTop: 10 }}>
                Components: {packetParse.packet.architecture_review.system_components.join(", ")}
              </p>
              <p className="meta-line">
                Dependencies: {packetParse.packet.architecture_review.critical_dependencies.join(", ")}
              </p>
            </section>

            <section className="studio-card">
              <h2>Milestones + Release Safety</h2>
              <div className="table-shell">
                <table className="studio-table compact">
                  <thead>
                    <tr>
                      <th>Milestone</th>
                      <th>Owner</th>
                      <th>Exit Criteria</th>
                    </tr>
                  </thead>
                  <tbody>
                    {packetParse.packet.build_plan.milestones.map((row) => (
                      <tr key={`${row.name}-${row.owner}`}>
                        <td>{row.name}</td>
                        <td>{row.owner}</td>
                        <td>{row.exit_criteria}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="meta-line" style={{ marginTop: 10 }}>
                Launch checklist: {packetParse.packet.launch_checklist.join(" · ")}
              </p>
              <p className="meta-line">Rollback triggers: {packetParse.packet.rollback_plan.triggers.join(" · ")}</p>
            </section>
          </>
        )}

        <AgentProcessPanel projectId={projectId} />

        <section className="studio-card">
          <h2>Latest Tasks</h2>
          {!phaseTasks.length ? (
            <p className="meta-line">No phase tasks logged yet.</p>
          ) : (
            <div className="table-shell">
              <table className="studio-table compact">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Task</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {phaseTasks.map((task) => {
                    const agent = getAgentProfile(task.agent);
                    const output = taskOutputLink(task.description, projectId);
                    return (
                      <tr key={task.id}>
                        <td>
                          <span style={{ color: agent.color, fontWeight: 600 }}>
                            {agent.icon} {agent.name}
                          </span>
                        </td>
                        <td>
                          <div className="table-main">{humanizeTaskDescription(task.description)}</div>
                          <div className="table-sub">{task.detail ?? ""}</div>
                        </td>
                        <td className={statusClass(task.status)}>
                          {task.status === "running" ? (
                            <AgentActivityIndicator agentKey={task.agent} taskDescription={humanizeTaskDescription(task.description)} compact />
                          ) : (
                            task.status
                          )}
                        </td>
                        <td>{new Date(task.created_at).toLocaleString()}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {task.status === "failed" && (
                            <RetryTaskButton projectId={projectId} />
                          )}
                          {task.status === "completed" && output && (
                            <Link href={output.href} className="btn btn-details btn-sm">
                              {output.label}
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <ProjectChatPane
          projectId={projectId}
          title="CEO Chat Pane"
          deliverableLinks={phase === 1 ? [
            ...(liveUrl ? [{ label: "Landing Page", href: liveUrl, external: true }] : []),
            ...landingVariantLinks,
            ...(brandBriefHtmlAsset ? [{ label: "Brand Brief", href: `/api/projects/${projectId}/assets/${brandBriefHtmlAsset.id}/preview`, external: true }] : []),
            ...(brandBriefPptxAsset ? [{ label: "Brand Deck (PPTX)", href: `/api/projects/${projectId}/assets/${brandBriefPptxAsset.id}/preview`, external: true }] : []),
            { label: "Phase 1 Workspace", href: `/projects/${projectId}/phases/1` },
          ] : undefined}
        />

        <section className="studio-card">
          <h2>Gate History</h2>
          {!approvals.length ? (
            <p className="meta-line">No gate entries yet for this phase.</p>
          ) : (
            <div className="table-shell">
              <table className="studio-table compact">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Risk</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {approvals.map((approval) => (
                    <tr key={approval.id}>
                      <td>{approval.title}</td>
                      <td className={riskClass(approval.risk)}>{approval.risk}</td>
                      <td className={statusClass(approval.status)}>{approval.status}</td>
                      <td>{new Date(approval.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
