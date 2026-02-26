export default function PlanReviewPage() {
  return (
    <main className="page studio-page">
      <section className="studio-card">
        <h1 className="page-title">Plan Review (Garry Tan)</h1>
        <p className="meta-line">Plan-exit-review decisions integrated into Startup Machine implementation.</p>
      </section>

      <section className="studio-card">
        <h2>Review Summary</h2>
        <div className="table-shell">
          <table className="studio-table compact">
            <thead>
              <tr>
                <th>Area</th>
                <th>Finding</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Scope</td>
                <td>Over-built day-1 architecture slowed shipping</td>
                <td>Ship MVG core loop first, then phase expansion</td>
              </tr>
              <tr>
                <td>Architecture</td>
                <td>Queue complexity introduced avoidable failure modes</td>
                <td>Use SDK orchestration + visible task/status telemetry</td>
              </tr>
              <tr>
                <td>Quality</td>
                <td>Unstructured outputs increased decision ambiguity</td>
                <td>Enforce schema contracts + optimistic locking</td>
              </tr>
              <tr>
                <td>Safety</td>
                <td>Silent failures reduce trust in autonomous runs</td>
                <td>Night Shift failures are logged and surfaced to users</td>
              </tr>
              <tr>
                <td>Delivery</td>
                <td>Shipping marketing scaffolding before product signals</td>
                <td>Prioritize product validation before scale spend</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="studio-card">
        <h2>Adopted Recommendations</h2>
        <div className="table-shell">
          <table className="studio-table compact">
            <thead>
              <tr>
                <th>ID</th>
                <th>Recommendation</th>
                <th>Implementation</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>#1A</td>
                <td>Drop heavy queue infra for day-1</td>
                <td>Agent SDK orchestration + task logging</td>
              </tr>
              <tr>
                <td>#2A</td>
                <td>Start with minimal MCP surface</td>
                <td>Supabase-first integration model</td>
              </tr>
              <tr>
                <td>#3A</td>
                <td>Keep deployment model simple</td>
                <td>Shared runtime landing deploy pipeline</td>
              </tr>
              <tr>
                <td>#4A</td>
                <td>Project-level data isolation</td>
                <td>RLS and owner checks on project queries</td>
              </tr>
              <tr>
                <td>#5A</td>
                <td>Prevent duplicated orchestration paths</td>
                <td>Centralized phase orchestration/execution modules</td>
              </tr>
              <tr>
                <td>#6A</td>
                <td>Typed reasoning contracts</td>
                <td>Zod validation for packets/synopsis</td>
              </tr>
              <tr>
                <td>#7A</td>
                <td>Centralized retry/error handling</td>
                <td>Shared retry wrapper and structured API errors</td>
              </tr>
              <tr>
                <td>#8A</td>
                <td>Golden fixture coverage</td>
                <td>Schema/unit/e2e tests covering onboarding + phase artifacts</td>
              </tr>
              <tr>
                <td>#9A</td>
                <td>Streaming/visible progress</td>
                <td>Project progress endpoint + launch polling UI</td>
              </tr>
              <tr>
                <td>#10A</td>
                <td>Cache expensive scans</td>
                <td>24-hour domain scan cache</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="studio-card">
        <h2>Operating Principles</h2>
        <div className="phase-deliverables">
          <span className="deliverable-chip">Always inspect existing assets before building</span>
          <span className="deliverable-chip">Phase gates require human approval in Inbox</span>
          <span className="deliverable-chip">No direct pushes to main in go-live workflows</span>
          <span className="deliverable-chip">Night Shift produces visible status and failures</span>
          <span className="deliverable-chip">Agent outputs must pass schema validation</span>
          <span className="deliverable-chip">No approval decision executes silently</span>
          <span className="deliverable-chip">Every deploy path has deterministic verification</span>
        </div>
      </section>
    </main>
  );
}
