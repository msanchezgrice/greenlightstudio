import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { StudioNav } from "@/components/studio-nav";
import { getOwnedProjects, getPendingApprovalsByProject } from "@/lib/studio";
import { PHASES, phaseStatus, type PhaseId } from "@/lib/phases";
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

  const [projectQuery, packetQuery, approvalsQuery, tasksQuery] = await Promise.all([
    withRetry(() =>
      db
        .from("projects")
        .select("id,name,domain,phase,runtime_mode,updated_at")
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
  ]);

  if (projectQuery.error || !projectQuery.data) {
    return (
      <>
        <StudioNav active="projects" pendingCount={pendingCount} />
        <main className="page studio-page">
          <section className="studio-card">
            <h2>Project not found</h2>
            <p className="meta-line">This project does not exist or is not accessible.</p>
          </section>
        </main>
      </>
    );
  }

  const project = projectQuery.data as ProjectRow;
  const packetRow = (packetQuery.data as PacketRow | null) ?? null;
  const approvals = (approvalsQuery.data ?? []) as ApprovalRow[];
  const allTasks = (tasksQuery.data ?? []) as TaskRow[];
  const phaseTasks = allTasks.filter((task) => task.description.startsWith(`phase${phase}_`)).slice(0, 30);

  const currentPhaseDefinition = PHASES.find((entry) => entry.id === phase) ?? PHASES[0];
  const status = phaseStatus(project.phase, phase);
  const gate = approvals[0] ?? null;
  const packetParse = packetRow ? safeParsePacket(phase as PhaseId, packetRow.packet) : { packet: null, error: null };

  return (
    <>
      <StudioNav active="projects" pendingCount={pendingCount} />
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
            {phase === 0 && (
              <Link href={`/projects/${projectId}/packet`} className="btn btn-preview">
                Open Phase 0 Packet
              </Link>
            )}
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
              <p className="meta-line">{packetParse.packet.summary}</p>
            </section>

            <section className="studio-card">
              <h2>Landing + Waitlist</h2>
              <div className="project-metrics">
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
              </div>
              <div className="table-shell" style={{ marginTop: 10 }}>
                <table className="studio-table compact">
                  <thead>
                    <tr>
                      <th>Landing Sections</th>
                      <th>Waitlist Fields</th>
                      <th>Launch Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{packetParse.packet.landing_page.sections.join(", ")}</td>
                      <td>{packetParse.packet.waitlist.form_fields.join(", ")}</td>
                      <td>{packetParse.packet.landing_page.launch_notes.join(", ")}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section className="studio-card">
              <h2>Analytics, Brand, and Comms</h2>
              <div className="table-shell">
                <table className="studio-table compact">
                  <thead>
                    <tr>
                      <th>Analytics</th>
                      <th>Brand</th>
                      <th>Social + Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        Provider: {packetParse.packet.analytics.provider}
                        <br />
                        Events: {packetParse.packet.analytics.events.join(", ")}
                        <br />
                        Views: {packetParse.packet.analytics.dashboard_views.join(", ")}
                      </td>
                      <td>
                        Voice: {packetParse.packet.brand_kit.voice}
                        <br />
                        Palette: {packetParse.packet.brand_kit.color_palette.join(", ")}
                        <br />
                        Fonts: {packetParse.packet.brand_kit.font_pairing}
                      </td>
                      <td>
                        Channels: {packetParse.packet.social_strategy.channels.join(", ")}
                        <br />
                        Cadence: {packetParse.packet.social_strategy.posting_cadence}
                        <br />
                        Emails: {packetParse.packet.email_sequence.emails.map((item) => `${item.day}: ${item.subject}`).join(" · ")}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
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

        <section className="studio-card">
          <h2>Latest Tasks</h2>
          {!phaseTasks.length ? (
            <p className="meta-line">No phase tasks logged yet.</p>
          ) : (
            <div className="table-shell">
              <table className="studio-table compact">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Agent</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {phaseTasks.map((task) => (
                    <tr key={task.id}>
                      <td>
                        <div className="table-main">{task.description}</div>
                        <div className="table-sub">{task.detail ?? "No detail"}</div>
                      </td>
                      <td>{task.agent}</td>
                      <td className={statusClass(task.status)}>{task.status}</td>
                      <td>{new Date(task.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

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
