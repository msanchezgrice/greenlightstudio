export default function PlanReviewPage() {
  return (
    <main className="page studio-page">
      <section className="studio-card">
        <h1 className="page-title">Plan Review (Garry Tan)</h1>
        <p className="meta-line">Structured plan-exit-review decisions from spec v2.3.</p>
      </section>

      <section className="studio-card">
        <h2>Scope Decisions</h2>
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
                <td>Day 1 Scope</td>
                <td>Full 8-agent system is over-built for launch</td>
                <td>Ship core loop first, then phase expansion</td>
              </tr>
              <tr>
                <td>Architecture</td>
                <td>Queue complexity too early</td>
                <td>Keep orchestration simple and observable</td>
              </tr>
              <tr>
                <td>Quality</td>
                <td>Inconsistent output contracts risk regressions</td>
                <td>Use strict schema validation + optimistic locking</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="studio-card">
        <h2>Applied Principles</h2>
        <div className="phase-deliverables">
          <span className="deliverable-chip">Always inspect existing assets before building</span>
          <span className="deliverable-chip">Phase gates require human approval in Inbox</span>
          <span className="deliverable-chip">No direct pushes to main in go-live workflows</span>
          <span className="deliverable-chip">Night Shift produces visible status and failures</span>
          <span className="deliverable-chip">Agent outputs must pass schema validation</span>
        </div>
      </section>
    </main>
  );
}
