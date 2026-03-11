import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { StudioNav } from "@/components/studio-nav";
import { LiveRefresh } from "@/components/live-refresh";
import { ProjectChatPane } from "@/components/project-chat-pane";
import { RetryTaskButton } from "@/components/retry-task-button";
import { AgentActivityIndicator } from "@/components/agent-activity";
import { AgentProcessPanel } from "@/components/agent-process-panel";
import { PhaseRefineControl } from "@/components/phase-refine-control";
import { getOwnedProjects, getPendingApprovalsByProject } from "@/lib/studio";
import { PHASES, phaseStatus, getAgentProfile, humanizeTaskDescription, taskOutputLink, type PhaseId } from "@/lib/phases";
import { buildPhase0Summary, type Phase0Summary } from "@/lib/phase0-summary";
import { scanResultSchema, type Packet } from "@/types/domain";
import { parsePhasePacket, type PhasePacket } from "@/types/phase-packets";
import { derivePhaseHighlights, readPacketSummaryForPhase } from "@/lib/phase-presentations";

type ProjectRow = {
  id: string;
  name: string;
  domain: string | null;
  phase: number;
  runtime_mode: "shared" | "attached";
  updated_at: string;
  scan_results?: unknown;
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

type Phase0SummaryEventRow = {
  created_at: string;
  data: Phase0Summary | null;
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

function renderLinkedText(text: string | null | undefined) {
  if (!text) return null;
  const pattern = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(pattern);
  if (parts.length === 1) return text;
  return parts.map((part, index) => {
    if (!/^https?:\/\/[^\s]+$/i.test(part)) return <span key={`txt-${index}`}>{part}</span>;
    return (
      <a key={`url-${index}`} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    );
  });
}

function dedupeLatestTasks(tasks: TaskRow[]) {
  const seen = new Set<string>();
  const deduped: TaskRow[] = [];
  for (const task of tasks) {
    const key = `${task.agent}:${task.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(task);
  }
  return deduped;
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

  const [projectQuery, packetQuery, approvalsQuery, tasksQuery, deploymentQuery, assetsQuery, brandFallbackAssetsQuery, phase0SummaryEventQuery] = await Promise.all([
    withRetry(() =>
      db
        .from("projects")
        .select("id,name,domain,phase,runtime_mode,updated_at,live_url,scan_results")
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
        .not("description", "ilike", "%_trace%")
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
        .limit(200),
    ),
    phase === 1
      ? withRetry(() =>
          db
            .from("project_assets")
            .select("id,kind,storage_path,filename,mime_type,metadata,created_at")
            .eq("project_id", projectId)
            .eq("status", "uploaded")
            .order("created_at", { ascending: false })
            .limit(220),
        )
      : Promise.resolve({ data: [], error: null }),
    phase === 0
      ? withRetry(() =>
          db
            .from("project_events")
            .select("created_at,data")
            .eq("project_id", projectId)
            .eq("event_type", "phase0.summary_ready")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        )
      : Promise.resolve({ data: null, error: null }),
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
  const phaseTasks = dedupeLatestTasks(allTasks.filter((task) => task.description.startsWith(`phase${phase}_`))).slice(0, 18);
  const deployment = deploymentQuery.data as { project_id: string; phase: number; status: string; metadata: Record<string, unknown>; deployed_at: string } | null;
  const phase0SummaryEvent = (phase0SummaryEventQuery.data as Phase0SummaryEventRow | null) ?? null;
  const assets = ([
    ...((assetsQuery.data ?? []) as Array<{
      id: string;
      kind: string;
      storage_path: string;
      filename: string;
      mime_type: string | null;
      metadata: Record<string, unknown>;
      created_at: string;
    }>),
    ...((brandFallbackAssetsQuery.data ?? []) as Array<{
      id: string;
      kind: string;
      storage_path: string;
      filename: string;
      mime_type: string | null;
      metadata: Record<string, unknown>;
      created_at: string;
    }>),
  ].reduce<Array<{
    id: string;
    kind: string;
    storage_path: string;
    filename: string;
    mime_type: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
  }>>((acc, asset) => {
    if (acc.some((row) => row.id === asset.id)) return acc;
    acc.push(asset);
    return acc;
  }, []));
  const brandAssets = assets.filter((a) => a.metadata?.brand_asset === true);
  const brandImageAssets = brandAssets.filter((asset) => (asset.mime_type ?? "").startsWith("image/"));
  const techNewsAsset = assets.find((a) => a.metadata?.tech_news_insights === true || a.filename === "tech-news-insights.md");
  const brandBriefHtmlAsset = assets.find((a) => a.filename === "brand-brief.html" || a.metadata?.brand_brief === true);
  const brandBriefPptxAsset = assets.find((a) => a.filename === "brand-brief.pptx" || a.metadata?.brand_brief_pptx === true);
  const packetDeckHtmlAsset = assets.find(
    (a) =>
      a.metadata?.phase_packet_embed === true ||
      a.filename === `phase-${phase}-packet.html`,
  );
  const packetDeckPptxAsset = assets.find(
    (a) =>
      a.metadata?.phase_packet_pptx === true ||
      a.filename === `phase-${phase}-packet.pptx`,
  );
  const phase2MarketingAssets = assets.filter(
    (a) => a.metadata?.phase2_marketing_assets === true || a.metadata?.phase2_marketing_plan === true,
  );
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
  const phaseAssetLinks: Array<{ label: string; href: string; external: boolean }> = [
    ...(packetDeckHtmlAsset ? [{ label: `Phase ${phase} Pitch Deck (HTML)`, href: `/api/projects/${projectId}/assets/${packetDeckHtmlAsset.id}/preview`, external: true }] : []),
    ...(packetDeckPptxAsset ? [{ label: `Phase ${phase} Pitch Deck (PPTX)`, href: `/api/projects/${projectId}/assets/${packetDeckPptxAsset.id}/preview`, external: true }] : []),
    ...(liveUrl ? [{ label: "Landing Page (Live)", href: liveUrl, external: true }] : []),
    ...(brandBriefHtmlAsset ? [{ label: "Brand Brief (HTML)", href: `/api/projects/${projectId}/assets/${brandBriefHtmlAsset.id}/preview`, external: true }] : []),
    ...(brandBriefPptxAsset ? [{ label: "Brand Brief (PPTX)", href: `/api/projects/${projectId}/assets/${brandBriefPptxAsset.id}/preview`, external: true }] : []),
    ...(techNewsAsset ? [{ label: "Tech + AI News Brief", href: `/api/projects/${projectId}/assets/${techNewsAsset.id}/preview`, external: true }] : []),
    ...landingVariantLinks,
    ...brandImageAssets.slice(0, 8).map((asset) => ({
      label: ((asset.metadata?.label as string) ?? asset.filename).slice(0, 42),
      href: `/api/projects/${projectId}/assets/${asset.id}/preview`,
      external: true,
    })),
  ];

  const currentPhaseDefinition = PHASES.find((entry) => entry.id === phase) ?? PHASES[0];
  const status = phaseStatus(project.phase, phase);
  const gate = approvals[0] ?? null;
  const packetParse = packetRow ? safeParsePacket(phase as PhaseId, packetRow.packet) : { packet: null, error: null };
  const phasePacketSummary = packetParse.packet ? readPacketSummaryForPhase(phase, packetParse.packet) : null;
  const phaseHighlights = packetParse.packet ? derivePhaseHighlights(phase, packetParse.packet, phasePacketSummary ?? "") : [];
  const normalizedPitchSummary = (phasePacketSummary ?? "").replace(/\s+/g, " ").trim();
  const pitchSummaryPreview =
    normalizedPitchSummary.length > 320 ? `${normalizedPitchSummary.slice(0, 320).trimEnd()}…` : normalizedPitchSummary;
  const validatedScanResults = scanResultSchema.safeParse(project.scan_results ?? null).success
    ? scanResultSchema.parse(project.scan_results ?? null)
    : null;
  const hasActivePhaseWork = phaseTasks.some((task) => task.status === "running" || task.status === "queued");
  const phase0Summary =
    phase === 0 && packetParse.packet && "market_sizing" in packetParse.packet
      ? (phase0SummaryEvent?.data ??
        buildPhase0Summary({
          packet: packetParse.packet as Packet,
          deliverables: [
            ...(packetDeckHtmlAsset ? [{ kind: "phase0_packet_html", label: "Phase 0 Pitch Deck (HTML)", url: `/api/projects/${projectId}/assets/${packetDeckHtmlAsset.id}/preview` }] : []),
            ...(packetDeckPptxAsset ? [{ kind: "phase0_packet_pptx", label: "Phase 0 Pitch Deck (PPTX)", url: `/api/projects/${projectId}/assets/${packetDeckPptxAsset.id}/preview` }] : []),
            ...(brandBriefHtmlAsset ? [{ kind: "phase0_brand_brief_html", label: "Brand Brief (HTML)", url: `/api/projects/${projectId}/assets/${brandBriefHtmlAsset.id}/preview` }] : []),
            ...(brandBriefPptxAsset ? [{ kind: "phase0_brand_brief_pptx", label: "Brand Brief (PPTX)", url: `/api/projects/${projectId}/assets/${brandBriefPptxAsset.id}/preview` }] : []),
            ...(techNewsAsset ? [{ kind: "phase0_tech_news", label: "Tech + AI News Brief", url: `/api/projects/${projectId}/assets/${techNewsAsset.id}/preview` }] : []),
            ...brandImageAssets.slice(0, 8).map((asset) => ({
              kind: "brand_asset",
              label: ((asset.metadata?.label as string) ?? asset.filename).slice(0, 48),
              url: `/api/projects/${projectId}/assets/${asset.id}/preview`,
            })),
          ],
          scanResults: validatedScanResults,
        }))
      : null;

  return (
    <>
      <StudioNav active="board" pendingCount={pendingCount} />
      <LiveRefresh intervalMs={9000} hasActiveWork={hasActivePhaseWork} activeIntervalMs={2500} />
      <main className="page studio-page studio-page-with-chat">
        <div className="studio-with-chat">
          <div className="studio-main-column">
            <div className="page-header">
          <div>
            <h1 className="page-title">
              {project.name} · {phaseLabel(phase)} Workspace
            </h1>
            <p className="meta-line">
              {currentPhaseDefinition.title} · {status} · updated {new Date(project.updated_at).toLocaleString()}
              {hasActivePhaseWork ? " · auto-updating while agents are running" : ""}
            </p>
          </div>
          <div className="table-actions">
            <Link href={`/projects/${projectId}/phases`} className="btn btn-details">
              All Phases
            </Link>
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
            <div className="metric-label">Pitch Deck Confidence</div>
            <div className="metric-value">{packetRow ? `${packetRow.confidence}/100` : "--"}</div>
          </div>
        </section>

        {phase === 0 && (
          <section
            className="studio-card"
            style={{
              borderColor: hasActivePhaseWork ? "rgba(34,197,94,.35)" : "var(--border)",
              background: hasActivePhaseWork
                ? "linear-gradient(135deg, rgba(34,197,94,.12), rgba(34,197,94,.03))"
                : "var(--card, rgba(255,255,255,.02))",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div>
                <h2 style={{ margin: 0 }}>
                  {phase0Summary || packetDeckHtmlAsset || brandBriefHtmlAsset ? "New Deliverables Landed" : "Phase 0 Live Status"}
                </h2>
                <p className="meta-line" style={{ marginTop: 8, marginBottom: 0, maxWidth: 760 }}>
                  {phase0Summary || packetDeckHtmlAsset || brandBriefHtmlAsset
                    ? "The workspace refreshes automatically. Open the deck, brand brief, or research links below as they land."
                    : hasActivePhaseWork
                      ? "This page is auto-updating while Phase 0 runs. Market research, deck output, and brand assets will appear here without a manual refresh."
                      : "Phase 0 is idle right now. When work resumes, this workspace will refresh itself automatically."}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {packetDeckHtmlAsset && (
                  <a
                    href={`/api/projects/${projectId}/assets/${packetDeckHtmlAsset.id}/preview`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-approve btn-sm"
                  >
                    Open Deck
                  </a>
                )}
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
                {techNewsAsset && (
                  <a
                    href={`/api/projects/${projectId}/assets/${techNewsAsset.id}/preview`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-details btn-sm"
                  >
                    Open Research Brief
                  </a>
                )}
              </div>
            </div>
          </section>
        )}

        <AgentProcessPanel projectId={projectId} />

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

        <section className="studio-card">
          <h2>Asset Links</h2>
          {!phaseAssetLinks.length ? (
            <p className="meta-line">No generated links yet for this phase.</p>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {phaseAssetLinks.map((link) => (
                <a
                  key={`${link.label}-${link.href}`}
                  href={link.href}
                  target={link.external ? "_blank" : undefined}
                  rel={link.external ? "noopener noreferrer" : undefined}
                  className="btn btn-details btn-sm"
                >
                  {link.label}
                </a>
              ))}
            </div>
          )}
        </section>

        {!packetRow && (
          <section className="studio-card">
            <h2>Phase Pitch Deck</h2>
            <p className="meta-line">No phase pitch deck generated yet for this phase.</p>
          </section>
        )}

        {packetRow && packetParse.error && (
          <section className="studio-card">
            <h2>Phase Pitch Deck</h2>
            <p className="meta-line">Pitch deck exists but failed validation: {packetParse.error}</p>
          </section>
        )}

        {packetRow && packetParse.packet && (
          <section className="studio-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Phase Pitch Deck</h2>
              <div className="table-actions">
                {packetDeckHtmlAsset && (
                  <a
                    href={`/api/projects/${projectId}/assets/${packetDeckHtmlAsset.id}/preview`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-details btn-sm"
                  >
                    Open Deck
                  </a>
                )}
                {packetDeckPptxAsset && (
                  <a
                    href={`/api/projects/${projectId}/assets/${packetDeckPptxAsset.id}/preview`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-details btn-sm"
                  >
                    Download PPTX
                  </a>
                )}
              </div>
            </div>
            <p className="meta-line" style={{ marginBottom: 10 }}>
              {pitchSummaryPreview || "No summary available yet."}
            </p>
            {normalizedPitchSummary.length > pitchSummaryPreview.length && (
              <details
                style={{
                  marginBottom: 12,
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "8px 10px",
                  background: "var(--surface, rgba(255,255,255,.03))",
                }}
              >
                <summary style={{ cursor: "pointer", color: "var(--text2)", fontSize: 13 }}>View full narrative</summary>
                <p style={{ margin: "8px 0 0", color: "var(--text2)", lineHeight: 1.55, fontSize: 13 }}>{normalizedPitchSummary}</p>
              </details>
            )}
            {phaseHighlights.length > 0 && (
              <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
                {phaseHighlights.slice(0, 6).map((item, idx) => (
                  <div
                    key={`phase-highlight-${idx}`}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      padding: "10px 12px",
                      background: "var(--surface, rgba(255,255,255,.03))",
                      fontSize: 13,
                      color: "var(--text2)",
                    }}
                  >
                    {item}
                  </div>
                ))}
              </div>
            )}
            {packetDeckHtmlAsset && (
              <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)", background: "#000" }}>
                <iframe
                  src={`/api/projects/${projectId}/assets/${packetDeckHtmlAsset.id}/preview`}
                  title={`Phase ${phase} Pitch Deck`}
                  style={{ width: "100%", height: 520, border: "none", display: "block" }}
                  sandbox="allow-scripts allow-same-origin"
                />
              </div>
            )}
            <PhaseRefineControl
              projectId={projectId}
              phase={phase}
              assetId={packetDeckHtmlAsset?.id ?? null}
              label={`Refine Phase ${phase} Pitch Deck + Assets`}
              placeholder="Example: tighten the market narrative, make competitor comparison more specific, and improve visual hierarchy."
            />
          </section>
        )}

        {phase === 0 && packetParse.packet && "market_sizing" in packetParse.packet && (
          <>
            <section className="studio-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                <div>
                  <h2 style={{ margin: 0 }}>Phase 0 Assets + Conclusions</h2>
                  <p className="meta-line" style={{ marginTop: 6, marginBottom: 0 }}>
                    {phase0Summary?.elevator_pitch ?? packetParse.packet.elevator_pitch}
                  </p>
                </div>
                {phase0Summary?.generated_at && (
                  <div className="meta-line" style={{ whiteSpace: "nowrap" }}>
                    Updated {new Date(phase0Summary.generated_at).toLocaleString()}
                  </div>
                )}
              </div>
              <div className="project-metrics">
                <div>
                  <div className="metric-label">Recommendation</div>
                  <div className="metric-value">{(phase0Summary?.recommendation ?? packetParse.packet.recommendation).toUpperCase()}</div>
                </div>
                <div>
                  <div className="metric-label">Confidence</div>
                  <div className="metric-value">{phase0Summary?.confidence ?? packetParse.packet.reasoning_synopsis.confidence}/100</div>
                </div>
                <div>
                  <div className="metric-label">TAM</div>
                  <div className="metric-value">{phase0Summary?.market.tam ?? packetParse.packet.market_sizing.tam}</div>
                </div>
                <div>
                  <div className="metric-label">SAM</div>
                  <div className="metric-value">{phase0Summary?.market.sam ?? packetParse.packet.market_sizing.sam}</div>
                </div>
                <div>
                  <div className="metric-label">SOM</div>
                  <div className="metric-value">{phase0Summary?.market.som ?? packetParse.packet.market_sizing.som}</div>
                </div>
                <div>
                  <div className="metric-label">Persona</div>
                  <div className="metric-value">{phase0Summary?.persona.name ?? packetParse.packet.target_persona.name}</div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 14 }}>
                {[
                  { label: "Why this could work", items: phase0Summary?.rationale ?? packetParse.packet.reasoning_synopsis.rationale.slice(0, 4) },
                  { label: "Open risks", items: phase0Summary?.risks ?? packetParse.packet.reasoning_synopsis.risks.slice(0, 4) },
                  { label: "Next actions", items: phase0Summary?.next_actions ?? packetParse.packet.reasoning_synopsis.next_actions.slice(0, 4) },
                ].map((group) => (
                  <div
                    key={group.label}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      padding: "12px 14px",
                      background: "var(--surface, rgba(255,255,255,.03))",
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>{group.label}</div>
                    <div style={{ display: "grid", gap: 8 }}>
                      {group.items.map((item, index) => (
                        <div key={`${group.label}-${index}`} className="meta-line" style={{ lineHeight: 1.55 }}>
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="studio-card">
              <h2>Branding Snapshot</h2>
              {phase0Summary?.branding ? (
                <>
                  <div className="project-metrics" style={{ marginBottom: 14 }}>
                    <div>
                      <div className="metric-label">Voice</div>
                      <div className="metric-value">{phase0Summary.branding.voice}</div>
                    </div>
                    <div>
                      <div className="metric-label">Typography</div>
                      <div className="metric-value">{phase0Summary.branding.font_pairing}</div>
                    </div>
                    <div>
                      <div className="metric-label">Palette</div>
                      <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                        {phase0Summary.branding.color_palette.map((color) => (
                          <div
                            key={color}
                            title={color}
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 8,
                              background: color,
                              border: "1px solid rgba(255,255,255,.15)",
                            }}
                          />
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="metric-label">Logo Direction</div>
                      <div className="metric-value" style={{ fontSize: 13 }}>{phase0Summary.branding.logo_prompt}</div>
                    </div>
                  </div>
                </>
              ) : (
                <p className="meta-line">Brand direction will populate here as Phase 0 assets finish generating.</p>
              )}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {brandBriefHtmlAsset && (
                  <a
                    href={`/api/projects/${projectId}/assets/${brandBriefHtmlAsset.id}/preview`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-details btn-sm"
                  >
                    Brand Brief (HTML)
                  </a>
                )}
                {brandBriefPptxAsset && (
                  <a
                    href={`/api/projects/${projectId}/assets/${brandBriefPptxAsset.id}/preview`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-details btn-sm"
                  >
                    Brand Brief (PPTX)
                  </a>
                )}
                {brandAssets.map((asset) => (
                  <a
                    key={asset.id}
                    href={`/api/projects/${projectId}/assets/${asset.id}/preview`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-details btn-sm"
                  >
                    {(asset.metadata?.label as string) ?? asset.filename}
                  </a>
                ))}
                {techNewsAsset && (
                  <a
                    href={`/api/projects/${projectId}/assets/${techNewsAsset.id}/preview`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-details btn-sm"
                  >
                    Tech + AI News Insights
                  </a>
                )}
              </div>

              {phase0Summary?.tech_news?.summary && (
                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: "12px 14px",
                    background: "var(--surface, rgba(255,255,255,.03))",
                    marginBottom: 14,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Tech + AI relevance</div>
                  <div className="meta-line" style={{ lineHeight: 1.6 }}>
                    {phase0Summary.tech_news.summary}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {brandAssets
                  .filter((asset) => (asset.mime_type ?? "").startsWith("image/"))
                  .slice(0, 6)
                  .map((asset) => (
                    <a
                      key={`phase0-brand-${asset.id}`}
                      href={`/api/projects/${projectId}/assets/${asset.id}/preview`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)" }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/projects/${projectId}/assets/${asset.id}/preview`}
                        alt={(asset.metadata?.label as string) ?? asset.filename}
                        style={{ width: 160, height: 110, objectFit: "cover", display: "block" }}
                      />
                    </a>
                  ))}
              </div>
            </section>

            <section className="studio-card">
              <h2>Competitors + Source Links</h2>
              <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
                {(phase0Summary?.competitors ?? []).map((competitor) => (
                  <div
                    key={competitor.name}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      padding: "12px 14px",
                      background: "var(--surface, rgba(255,255,255,.03))",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{competitor.name}</div>
                        <div className="meta-line" style={{ marginTop: 4 }}>{competitor.positioning}</div>
                        <div className="meta-line" style={{ marginTop: 4 }}>
                          Gap: {competitor.gap} · Pricing: {competitor.pricing}
                        </div>
                      </div>
                      <a href={competitor.url} target="_blank" rel="noopener noreferrer" className="btn btn-details btn-sm">
                        Open
                      </a>
                    </div>
                  </div>
                ))}
              </div>

              {phase0Summary?.evidence?.length ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {phase0Summary.evidence.map((item, index) => (
                    <div
                      key={`evidence-${index}`}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: "12px 14px",
                        background: "var(--surface, rgba(255,255,255,.03))",
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>{item.claim}</div>
                      <a href={item.url} target="_blank" rel="noopener noreferrer" className="meta-line">
                        {item.source}
                      </a>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="meta-line">Source links will appear here as research evidence is assembled.</p>
              )}
            </section>
          </>
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
              <PhaseRefineControl
                projectId={projectId}
                phase={1}
                assetId={landingAsset?.id ?? null}
                label="Refine Landing Page"
                placeholder="Example: change CTA button to #7C3AED, increase contrast, and simplify hero copy."
              />
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
              {brandImageAssets.length > 0 && (
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 20 }}>
                  {brandImageAssets.map((asset) => {
                    const label = (asset.metadata?.label as string) ?? asset.filename;
                    return (
                      <a
                        key={asset.id}
                        href={`/api/projects/${projectId}/assets/${asset.id}/preview`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ textAlign: "center", textDecoration: "none", color: "inherit" }}
                      >
                        <div
                          style={{
                            width: 180,
                            height: 120,
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
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                        </div>
                        <div className="meta-line" style={{ fontSize: 12 }}>{label}</div>
                      </a>
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
              <PhaseRefineControl
                projectId={projectId}
                phase={1}
                assetId={brandBriefHtmlAsset?.id ?? null}
                label="Refine Brand Pitch Deck"
                placeholder="Example: make brand voice less generic, update palette to warmer tones, and regenerate deck visuals."
              />
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

            <section className="studio-card">
              <h2>Social + Marketing Assets</h2>
              {!phase2MarketingAssets.length ? (
                <p className="meta-line">No generated social/marketing assets yet.</p>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
                    {phase2MarketingAssets.map((asset) => (
                      <a
                        key={asset.id}
                        href={`/api/projects/${projectId}/assets/${asset.id}/preview`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-details btn-sm"
                      >
                        {(asset.metadata?.label as string) ?? asset.filename}
                      </a>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    {phase2MarketingAssets
                      .filter((asset) => (asset.mime_type ?? "").startsWith("image/"))
                      .slice(0, 6)
                      .map((asset) => (
                        <a
                          key={`img-${asset.id}`}
                          href={`/api/projects/${projectId}/assets/${asset.id}/preview`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)" }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/projects/${projectId}/assets/${asset.id}/preview`}
                            alt={(asset.metadata?.label as string) ?? asset.filename}
                            style={{ width: 180, height: 120, objectFit: "cover", display: "block" }}
                          />
                        </a>
                      ))}
                  </div>
                </>
              )}
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
                    <th className="col-agent">Agent</th>
                    <th className="col-task">Task</th>
                    <th className="col-status">Status</th>
                    <th className="col-created">Created</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {phaseTasks.map((task) => {
                    const agent = getAgentProfile(task.agent);
                    const output = taskOutputLink(task.description, projectId);
                    return (
                      <tr key={task.id}>
                        <td className="col-agent">
                          <span className="agent-inline-label" style={{ color: agent.color, fontWeight: 600 }}>
                            {agent.icon} {agent.name}
                          </span>
                        </td>
                        <td className="col-task">
                          <div className="table-main">{humanizeTaskDescription(task.description)}</div>
                          <div className="table-sub">{renderLinkedText(task.detail)}</div>
                        </td>
                        <td className={`col-status ${statusClass(task.status)}`}>
                          {task.status === "running" ? (
                            <AgentActivityIndicator agentKey={task.agent} taskDescription={humanizeTaskDescription(task.description)} compact />
                          ) : (
                            task.status
                          )}
                        </td>
                        <td className="col-created">{new Date(task.created_at).toLocaleString()}</td>
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
          </div>

          <aside className="studio-chat-rail">
            <ProjectChatPane
              projectId={projectId}
              title="CEO Agent"
              deliverableLinks={phase === 1 ? [
                ...(packetDeckHtmlAsset ? [{ label: "Phase Deck", href: `/api/projects/${projectId}/assets/${packetDeckHtmlAsset.id}/preview`, external: true }] : []),
                ...(packetDeckPptxAsset ? [{ label: "Phase Deck PPTX", href: `/api/projects/${projectId}/assets/${packetDeckPptxAsset.id}/preview`, external: true }] : []),
                ...(liveUrl ? [{ label: "Landing Page", href: liveUrl, external: true }] : []),
                ...landingVariantLinks,
                ...(brandBriefHtmlAsset ? [{ label: "Brand Brief", href: `/api/projects/${projectId}/assets/${brandBriefHtmlAsset.id}/preview`, external: true }] : []),
                ...(brandBriefPptxAsset ? [{ label: "Brand Deck (PPTX)", href: `/api/projects/${projectId}/assets/${brandBriefPptxAsset.id}/preview`, external: true }] : []),
                ...brandImageAssets
                  .slice(0, 4)
                  .map((asset) => ({
                    label: ((asset.metadata?.label as string) ?? asset.filename).slice(0, 36),
                    href: `/api/projects/${projectId}/assets/${asset.id}/preview`,
                    external: true,
                  })),
                { label: "Phase 1 Workspace", href: `/projects/${projectId}/phases/1` },
              ] : [
                ...(packetDeckHtmlAsset ? [{ label: "Phase Deck", href: `/api/projects/${projectId}/assets/${packetDeckHtmlAsset.id}/preview`, external: true }] : []),
                ...(packetDeckPptxAsset ? [{ label: "Phase Deck PPTX", href: `/api/projects/${projectId}/assets/${packetDeckPptxAsset.id}/preview`, external: true }] : []),
                ...(phase === 0 && brandBriefHtmlAsset ? [{ label: "Brand Brief", href: `/api/projects/${projectId}/assets/${brandBriefHtmlAsset.id}/preview`, external: true }] : []),
                ...(phase === 0 && brandBriefPptxAsset ? [{ label: "Brand Deck (PPTX)", href: `/api/projects/${projectId}/assets/${brandBriefPptxAsset.id}/preview`, external: true }] : []),
                ...(phase === 0 && techNewsAsset ? [{ label: "Tech + AI News", href: `/api/projects/${projectId}/assets/${techNewsAsset.id}/preview`, external: true }] : []),
                ...(phase === 0
                  ? brandImageAssets
                      .slice(0, 4)
                      .map((asset) => ({
                        label: ((asset.metadata?.label as string) ?? asset.filename).slice(0, 36),
                        href: `/api/projects/${projectId}/assets/${asset.id}/preview`,
                        external: true,
                      }))
                  : []),
                { label: "Phase Overview", href: `/projects/${projectId}/phases` },
                { label: "Current Workspace", href: `/projects/${projectId}/phases/${phase}` },
                ...(liveUrl ? [{ label: "Live Landing", href: liveUrl, external: true }] : []),
                ...(phase === 2
                  ? phase2MarketingAssets
                      .slice(0, 4)
                      .map((asset) => ({
                        label: ((asset.metadata?.label as string) ?? asset.filename).slice(0, 36),
                        href: `/api/projects/${projectId}/assets/${asset.id}/preview`,
                        external: true,
                      }))
                  : []),
              ]}
            />
          </aside>
        </div>
      </main>
    </>
  );
}
