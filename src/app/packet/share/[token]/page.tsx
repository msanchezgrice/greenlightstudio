import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { packetSchema } from "@/types/domain";

type ShareRow = {
  project_id: string;
  token: string;
};

export default async function PacketSharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = createServiceSupabase();

  const { data: share, error: shareError } = await withRetry(() =>
    db.from("packet_share_links").select("project_id,token").eq("token", token).single(),
  );
  if (shareError || !share) {
    return (
      <main className="page studio-page">
        <section className="studio-card">
          <h1 className="page-title">Shared Packet Not Found</h1>
          <p className="meta-line">This share link is invalid.</p>
        </section>
      </main>
    );
  }

  const shareRow = share as ShareRow;

  const [{ data: project }, { data: packetRow }] = await Promise.all([
    withRetry(() => db.from("projects").select("name,domain,created_at").eq("id", shareRow.project_id).single()),
    withRetry(() => db.from("phase_packets").select("packet,confidence,created_at").eq("project_id", shareRow.project_id).eq("phase", 0).single()),
  ]);

  if (!project || !packetRow) {
    return (
      <main className="page studio-page">
        <section className="studio-card">
          <h1 className="page-title">Shared Packet Not Available</h1>
          <p className="meta-line">The linked project packet could not be loaded.</p>
        </section>
      </main>
    );
  }

  const parsed = packetSchema.safeParse(packetRow.packet);
  if (!parsed.success) {
    return (
      <main className="page studio-page">
        <section className="studio-card">
          <h1 className="page-title">Shared Packet Invalid</h1>
          <p className="meta-line">Packet data failed validation.</p>
        </section>
      </main>
    );
  }

  const packet = parsed.data;

  return (
    <main className="page studio-page">
      <section className="studio-card">
        <h1 className="page-title">{project.name} · Phase 0 Packet (Shared)</h1>
        <p className="meta-line">
          {project.domain ?? "No domain"} · confidence {packetRow.confidence}/100 · generated{" "}
          {new Date(packetRow.created_at).toLocaleString()}
        </p>
      </section>

      <section className="studio-card">
        <h2>Tagline</h2>
        <p className="meta-line">{packet.tagline}</p>
      </section>

      <section className="studio-card">
        <h2>Elevator Pitch</h2>
        <p className="meta-line">{packet.elevator_pitch}</p>
      </section>

      <section className="studio-card">
        <h2>Recommendation</h2>
        <p className="meta-line">
          {packet.recommendation.toUpperCase()} · {packet.reasoning_synopsis.confidence}/100 confidence
        </p>
      </section>

      <section className="studio-card">
        <h2>Market Sizing</h2>
        <div className="project-metrics">
          <div>
            <div className="metric-label">TAM</div>
            <div className="metric-value">{packet.market_sizing.tam}</div>
          </div>
          <div>
            <div className="metric-label">SAM</div>
            <div className="metric-value">{packet.market_sizing.sam}</div>
          </div>
          <div>
            <div className="metric-label">SOM</div>
            <div className="metric-value">{packet.market_sizing.som}</div>
          </div>
        </div>
      </section>

      <section className="studio-card">
        <h2>Target Persona</h2>
        <p className="meta-line">
          <strong>{packet.target_persona.name}</strong> — {packet.target_persona.description}
        </p>
        <p className="meta-line">Pain points: {packet.target_persona.pain_points.join(", ")}</p>
      </section>

      <section className="studio-card">
        <h2>MVP Scope</h2>
        <p className="meta-line">In scope: {packet.mvp_scope.in_scope.join(", ")}</p>
        <p className="meta-line">Deferred: {packet.mvp_scope.deferred.join(", ")}</p>
      </section>

      <section className="studio-card">
        <h2>Competitor Analysis</h2>
        <div className="table-shell">
          <table className="studio-table compact">
            <thead>
              <tr>
                <th>Competitor</th>
                <th>Positioning</th>
                <th>Gap</th>
                <th>Pricing</th>
              </tr>
            </thead>
            <tbody>
              {packet.competitor_analysis.map((competitor) => (
                <tr key={competitor.name}>
                  <td>{competitor.name}</td>
                  <td>{competitor.positioning}</td>
                  <td>{competitor.gap}</td>
                  <td>{competitor.pricing}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="studio-card">
        <h2>Reasoning Synopsis</h2>
        <p className="meta-line">Decision: {packet.reasoning_synopsis.decision}</p>
        <p className="meta-line">Rationale: {packet.reasoning_synopsis.rationale.join(" · ")}</p>
        <p className="meta-line">Risks: {packet.reasoning_synopsis.risks.join(" · ")}</p>
        <p className="meta-line">Next actions: {packet.reasoning_synopsis.next_actions.join(" · ")}</p>
      </section>
    </main>
  );
}
