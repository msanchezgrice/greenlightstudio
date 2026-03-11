import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { StudioNav } from "@/components/studio-nav";
import { LiveRefresh } from "@/components/live-refresh";
import { getOwnedProjects, getPendingApprovalsByProject } from "@/lib/studio";
import { getLaunchHubResponse } from "@/lib/launch-hub";
import type { LaunchHubAsset, LaunchHubSectionId } from "@/types/launch-hub";

function sectionTitle(section: LaunchHubSectionId) {
  if (section === "landing") return "Landing";
  if (section === "brand") return "Brand";
  if (section === "gtm") return "GTM";
  return "Decks & Exports";
}

function sectionDescription(section: LaunchHubSectionId) {
  if (section === "landing") return "Current landing variants and live preview-ready HTML.";
  if (section === "brand") return "Brand briefs, logo treatments, and generated visuals.";
  if (section === "gtm") return "Social + marketing plans and launch campaign assets.";
  return "Phase packet exports and presentation-style assets.";
}

function AssetGrid({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: LaunchHubAsset[];
}) {
  return (
    <section className="studio-card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ marginBottom: 6 }}>{title}</h2>
          <p className="meta-line" style={{ margin: 0 }}>{description}</p>
        </div>
        <div className="pill blue">{items.length} asset{items.length === 1 ? "" : "s"}</div>
      </div>

      {!items.length ? (
        <p className="meta-line">No {title.toLowerCase()} assets yet.</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 14,
          }}
        >
          {items.map((asset) => (
            <article
              key={asset.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 16,
                background: "var(--surface, rgba(255,255,255,.03))",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                <div>
                  <div className="table-main">{asset.label}</div>
                  <div className="table-sub">{asset.filename}</div>
                </div>
                {asset.badge ? <span className="pill blue">{asset.badge}</span> : null}
              </div>
              <div className="meta-line">
                {asset.phase !== null ? `Phase ${asset.phase}` : "Project asset"} · {new Date(asset.createdAt).toLocaleString()}
              </div>
              <div className="table-actions" style={{ marginTop: "auto" }}>
                <a href={asset.previewUrl} target="_blank" rel="noopener noreferrer" className="btn btn-details btn-sm">
                  Preview
                </a>
                <a href={asset.downloadUrl} className="btn btn-details btn-sm">
                  Download
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default async function ProjectLaunchHubPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return null;

  const { projectId } = await params;
  const projects = await getOwnedProjects(userId);
  const projectIds = projects.map((entry) => entry.id);
  const { total: pendingCount } = await getPendingApprovalsByProject(projectIds);
  const launchHub = await getLaunchHubResponse(userId, projectId);

  if (!launchHub) notFound();

  const totalAssets = Object.values(launchHub.sections).reduce((sum, items) => sum + items.length, 0);
  const hasPreview = launchHub.preview.status === "ready" && Boolean(launchHub.preview.url);
  const statusTone = hasPreview ? "good" : "warn";

  return (
    <>
      <StudioNav active="board" pendingCount={pendingCount} />
      <LiveRefresh intervalMs={10000} hasActiveWork={false} />
      <main className="page studio-page">
        <div className="page-header">
          <div>
            <h1 className="page-title">{launchHub.project.name} · Launch Hub</h1>
            <p className="meta-line">
              Phase {launchHub.project.phase} · {launchHub.project.runtimeMode} runtime · updated {new Date(launchHub.project.updatedAt).toLocaleString()}
            </p>
          </div>
          <div className="table-actions">
            {launchHub.preview.url ? (
              <a href={launchHub.preview.url} target="_blank" rel="noopener noreferrer" className="btn btn-approve">
                Open Preview
              </a>
            ) : (
              <span className="btn btn-details" style={{ opacity: 0.6, cursor: "not-allowed" }}>
                Preview Pending
              </span>
            )}
            <a href={launchHub.bundle.downloadUrl} className="btn btn-preview">
              Download Launch Pack
            </a>
            <Link href={`/projects/${projectId}/logs`} className="btn btn-details">
              Project Log
            </Link>
          </div>
        </div>

        <section className="studio-card">
          <div className="project-metrics">
            <div>
              <div className="metric-label">Preview Status</div>
              <div className={`metric-value ${statusTone}`}>{hasPreview ? "Ready" : "Not ready"}</div>
            </div>
            <div>
              <div className="metric-label">Preview URL</div>
              <div className="metric-value" style={{ fontSize: 14 }}>{launchHub.preview.url ?? `/launch/${projectId}`}</div>
            </div>
            <div>
              <div className="metric-label">Selected Landing</div>
              <div className="metric-value" style={{ fontSize: 14 }}>{launchHub.preview.selectedVariantLabel ?? "Not selected"}</div>
            </div>
            <div>
              <div className="metric-label">Launch Assets</div>
              <div className="metric-value">{totalAssets}</div>
            </div>
            <div>
              <div className="metric-label">Bundle Items</div>
              <div className="metric-value">{launchHub.bundle.count}</div>
            </div>
          </div>
        </section>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 1fr)",
            gap: 20,
            alignItems: "start",
            marginBottom: 20,
          }}
        >
          <section className="studio-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 12 }}>
              <div>
                <h2 style={{ marginBottom: 6 }}>Live Preview</h2>
                <p className="meta-line" style={{ margin: 0 }}>
                  {hasPreview ? "Current project preview under Greenlight." : "A preview will appear here after the landing page is deployed."}
                </p>
              </div>
              {launchHub.preview.updatedAt ? (
                <span className="pill blue">Updated {new Date(launchHub.preview.updatedAt).toLocaleString()}</span>
              ) : null}
            </div>
            {hasPreview && launchHub.preview.url ? (
              <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)", background: "#000" }}>
                <iframe
                  src={launchHub.preview.url}
                  title="Launch Preview"
                  style={{ width: "100%", height: 560, border: "none", display: "block" }}
                  sandbox="allow-scripts allow-forms allow-same-origin"
                />
              </div>
            ) : (
              <div
                style={{
                  borderRadius: 12,
                  border: "1px dashed var(--border)",
                  padding: 24,
                  background: "var(--surface, rgba(255,255,255,.02))",
                }}
              >
                <p className="meta-line" style={{ margin: 0 }}>
                  No live preview yet. Once Phase 1 landing output is deployed, this page will show the public `/launch/${projectId}` site here.
                </p>
              </div>
            )}
          </section>

          <section className="studio-card">
            <h2 style={{ marginBottom: 6 }}>Launch Notes</h2>
            <p className="meta-line" style={{ marginBottom: 12 }}>
              This hub is the clean handoff surface for your landing page and launch materials.
            </p>
            {launchHub.emptyState ? (
              <div
                style={{
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  padding: 16,
                  background: "var(--surface, rgba(255,255,255,.03))",
                  marginBottom: 14,
                }}
              >
                <div className="table-main" style={{ marginBottom: 6 }}>{launchHub.emptyState.title}</div>
                <p className="meta-line" style={{ marginBottom: 10 }}>{launchHub.emptyState.description}</p>
                <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text2)", lineHeight: 1.5 }}>
                  {launchHub.emptyState.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div
              style={{
                borderRadius: 12,
                border: "1px solid var(--border)",
                padding: 16,
                background: "var(--surface, rgba(255,255,255,.03))",
              }}
            >
              <div className="table-main" style={{ marginBottom: 6 }}>Want to use this on your own domain?</div>
              <p className="meta-line" style={{ margin: 0 }}>
                If you love the landing page and want to use it beyond the Greenlight preview URL, we can help next.
              </p>
            </div>
          </section>
        </div>

        <div style={{ display: "grid", gap: 20 }}>
          {(["landing", "brand", "gtm", "exports"] as LaunchHubSectionId[]).map((section) => (
            <AssetGrid
              key={section}
              title={sectionTitle(section)}
              description={sectionDescription(section)}
              items={launchHub.sections[section]}
            />
          ))}
        </div>
      </main>
    </>
  );
}
