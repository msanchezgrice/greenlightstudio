"use client";

import { useMemo, useState } from "react";
import { onboardingSchema, scanResultSchema, type ScanResult } from "@/types/domain";

type Step = "import" | "discover" | "results" | "error" | "clarify" | "confirm" | "launched";

const focusSuggestions = ["Product Definition", "Validation", "Distribution", "Monetization", "Retention"];

function statusClass(step: Step, target: Step) {
  const order: Step[] = ["import", "discover", "results", "clarify", "confirm", "launched"];
  const stepIndex = order.indexOf(step);
  const targetIndex = order.indexOf(target);
  if (stepIndex > targetIndex) return "done";
  if (stepIndex === targetIndex) return "active";
  return "upcoming";
}

export function OnboardingWizard() {
  const [step, setStep] = useState<Step>("import");
  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [launchProgress, setLaunchProgress] = useState<
    Array<{ agent: string; description: string; status: string; detail: string | null; created_at: string }>
  >([]);
  const [form, setForm] = useState({
    domain: "",
    idea_description: "",
    repo_url: "",
    runtime_mode: "shared" as "shared" | "attached",
    permissions: { repo_write: false, deploy: false, ads_budget_cap: 0, email_send: false },
    night_shift: true,
    focus_areas: ["Product Definition"],
    scan_results: null as ScanResult | null,
  });

  const scanSummary = useMemo(() => {
    if (!form.scan_results) return [];
    const rows = [
      ["DNS", form.scan_results.dns ?? "unknown"],
      ["HTTP", form.scan_results.http_status ? String(form.scan_results.http_status) : "none"],
      ["Content", form.scan_results.existing_content],
      ["Title", form.scan_results.meta?.title ?? "none"],
      ["Description", form.scan_results.meta?.desc ?? "none"],
      ["Tech", form.scan_results.tech_stack?.length ? form.scan_results.tech_stack.join(", ") : "none"],
    ] as const;
    return rows;
  }, [form.scan_results]);

  function ensureImportIsValid() {
    if (form.idea_description.trim().length < 20) {
      setError("Idea description must be at least 20 characters.");
      return false;
    }
    if (form.repo_url && !/^https?:\/\//i.test(form.repo_url)) {
      setError("Repo URL must start with http:// or https://.");
      return false;
    }
    setError(null);
    return true;
  }

  async function runScan() {
    if (!ensureImportIsValid()) return;
    if (!form.domain) {
      setStep("clarify");
      return;
    }

    setBusy(true);
    setStep("discover");
    setError(null);

    try {
      const res = await fetch("/api/onboarding/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: form.domain }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Scan failed");

      const parsed = scanResultSchema.parse(json);
      setForm((prev) => ({ ...prev, scan_results: parsed }));
      setStep(parsed.error ? "error" : "results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
      setStep("error");
    } finally {
      setBusy(false);
    }
  }

  async function createProject() {
    if (!ensureImportIsValid()) return;
    if (!form.focus_areas.filter(Boolean).length) {
      setError("Select at least one focus area.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const payload = onboardingSchema.parse({
        ...form,
        domain: form.domain.trim() || null,
        repo_url: form.repo_url.trim() || null,
        focus_areas: form.focus_areas.filter(Boolean),
      });

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Project creation failed");

      setProjectId(json.projectId);
      setStep("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Project creation failed");
    } finally {
      setBusy(false);
    }
  }

  async function launchProject() {
    if (!projectId) {
      setError("Missing project ID.");
      return;
    }

    setBusy(true);
    setError(null);
    setLaunchProgress([]);

    try {
      const pollProgress = async () => {
        const progressRes = await fetch(`/api/projects/${projectId}/progress`, { cache: "no-store" });
        if (!progressRes.ok) return;
        const progressJson = await progressRes.json();
        setLaunchProgress(progressJson.tasks ?? []);
      };

      await pollProgress();

      let finished = false;
      let launchError: Error | null = null;
      const launchRequest = fetch(`/api/projects/${projectId}/launch`, { method: "POST" })
        .then(async (res) => {
          const json = await res.json();
          if (!res.ok) throw new Error(json.error ?? "Launch failed");
        })
        .catch((err: unknown) => {
          launchError = err instanceof Error ? err : new Error("Launch failed");
        })
        .finally(() => {
          finished = true;
        });

      while (!finished) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        await pollProgress();
      }

      await launchRequest;
      await pollProgress();
      if (launchError) throw launchError;

      setStep("launched");
      setTimeout(() => {
        window.location.href = "/inbox";
      }, 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Launch failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wizard-shell">
      <div className="wizard-progress">
        <div className={`step ${statusClass(step, "import")}`}>Import</div>
        <div className={`step ${statusClass(step, "discover")}`}>Discover</div>
        <div className={`step ${statusClass(step, "results")}`}>Results</div>
        <div className={`step ${statusClass(step, "clarify")}`}>Clarify</div>
        <div className={`step ${statusClass(step, "confirm")}`}>Confirm</div>
      </div>

      {error && <div className="wizard-error">{error}</div>}

      {step === "import" && (
        <section className="wizard-card">
          <div className="wizard-title-row">
            <h2>Step 0: Import</h2>
            <span className="pill cyan">S0</span>
          </div>
          <p className="wizard-desc">Capture required context before discovery scan.</p>
          <label className="field-label">Domain (optional)</label>
          <input
            className="mock-input"
            placeholder="offlinedad.com"
            value={form.domain}
            onChange={(event) => setForm((prev) => ({ ...prev, domain: event.target.value }))}
          />
          <label className="field-label">Idea Description (required)</label>
          <textarea
            className="mock-textarea"
            value={form.idea_description}
            placeholder="Describe what you are building, target audience, and value proposition..."
            onChange={(event) => setForm((prev) => ({ ...prev, idea_description: event.target.value }))}
          />
          <label className="field-label">Repository URL (optional)</label>
          <input
            className="mock-input"
            placeholder="https://github.com/org/repo"
            value={form.repo_url}
            onChange={(event) => setForm((prev) => ({ ...prev, repo_url: event.target.value }))}
          />
          <div className="button-row">
            <button className="mock-btn primary" onClick={runScan} disabled={busy}>Run Discovery</button>
            <button className="mock-btn secondary" onClick={() => setStep("clarify")} disabled={busy}>Skip Scan</button>
          </div>
        </section>
      )}

      {step === "discover" && (
        <section className="wizard-card">
          <div className="wizard-title-row">
            <h2>Step 1: Discover</h2>
            <span className="pill green">S1</span>
          </div>
          <p className="wizard-desc">Running DNS, HTTP, meta, and tech detection checks.</p>
          <div className="loading-bar"><div className="fill" /></div>
          <p className="muted">Scanning {form.domain}...</p>
        </section>
      )}

      {step === "results" && (
        <section className="wizard-card">
          <div className="wizard-title-row">
            <h2>Step 1.5: Scan Results</h2>
            <span className="pill blue">S1.5</span>
          </div>
          <p className="wizard-desc">Review discovery output before continuing.</p>

          <div className="scan-grid">
            {scanSummary.map(([label, value]) => (
              <div key={label} className="confirm-row">
                <span className="confirm-label">{label}</span>
                <span className="confirm-value">{value}</span>
              </div>
            ))}
          </div>

          <div className="button-row">
            <button className="mock-btn primary" onClick={() => setStep("clarify")}>Confirm Results</button>
            <button className="mock-btn secondary" onClick={() => setStep("import")}>Edit Inputs</button>
          </div>
        </section>
      )}

      {step === "error" && (
        <section className="wizard-card">
          <div className="wizard-title-row">
            <h2>Step 1.5e: Scan Error</h2>
            <span className="pill red">S1.5e</span>
          </div>
          <p className="wizard-desc">Discovery failed. Continue anyway or retry.</p>
          <div className="warning-state">
            <p className="warning-text">{form.scan_results?.error ?? error ?? "Unknown scan error"}</p>
          </div>
          <div className="button-row">
            <button className="mock-btn primary" onClick={() => setStep("clarify")}>Continue Anyway</button>
            <button className="mock-btn secondary" onClick={runScan} disabled={busy}>Retry Scan</button>
          </div>
        </section>
      )}

      {step === "clarify" && (
        <section className="wizard-card">
          <div className="wizard-title-row">
            <h2>Step 2: Clarify</h2>
            <span className="pill yellow">S2</span>
          </div>
          <p className="wizard-desc">Set execution mode, permissions, and operating constraints.</p>

          <label className="field-label">Runtime Mode</label>
          <div className="radio-group">
            <button
              className={`mock-radio ${form.runtime_mode === "shared" ? "selected" : ""}`}
              onClick={() => setForm((prev) => ({ ...prev, runtime_mode: "shared" }))}
              type="button"
            >
              <span className="mock-radio-dot" />
              <span>
                <span className="mock-radio-label">Shared Runtime</span>
                <span className="mock-radio-desc">Use Greenlight managed deployment runtime.</span>
              </span>
            </button>
            <button
              className={`mock-radio ${form.runtime_mode === "attached" ? "selected" : ""}`}
              onClick={() => setForm((prev) => ({ ...prev, runtime_mode: "attached" }))}
              type="button"
            >
              <span className="mock-radio-dot" />
              <span>
                <span className="mock-radio-label">Attached Runtime</span>
                <span className="mock-radio-desc">Operate directly against connected repository.</span>
              </span>
            </button>
          </div>

          <label className="field-label">Permission Ladder</label>
          <div className="toggle-grid">
            <label className="toggle-row"><input type="checkbox" checked={form.permissions.repo_write} onChange={(event) => setForm((prev) => ({ ...prev, permissions: { ...prev.permissions, repo_write: event.target.checked } }))} /> Repo Write</label>
            <label className="toggle-row"><input type="checkbox" checked={form.permissions.deploy} onChange={(event) => setForm((prev) => ({ ...prev, permissions: { ...prev.permissions, deploy: event.target.checked } }))} /> Deploy</label>
            <label className="toggle-row"><input type="checkbox" checked={form.permissions.email_send} onChange={(event) => setForm((prev) => ({ ...prev, permissions: { ...prev.permissions, email_send: event.target.checked } }))} /> Email Send</label>
            <label className="toggle-row"><input type="checkbox" checked={form.night_shift} onChange={(event) => setForm((prev) => ({ ...prev, night_shift: event.target.checked }))} /> Night Shift</label>
          </div>

          <label className="field-label">Ads Budget Cap (USD/day)</label>
          <input
            className="mock-input"
            type="number"
            min={0}
            value={form.permissions.ads_budget_cap}
            onChange={(event) => setForm((prev) => ({ ...prev, permissions: { ...prev.permissions, ads_budget_cap: Number(event.target.value) || 0 } }))}
          />

          <label className="field-label">Focus Areas</label>
          <div className="tag-wrap">
            {focusSuggestions.map((focus) => {
              const selected = form.focus_areas.includes(focus);
              return (
                <button
                  type="button"
                  key={focus}
                  className={`mock-tag ${selected ? "added" : ""}`}
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      focus_areas: selected
                        ? prev.focus_areas.filter((item) => item !== focus)
                        : [...prev.focus_areas, focus],
                    }))
                  }
                >
                  {focus}
                </button>
              );
            })}
          </div>

          <div className="button-row">
            <button className="mock-btn primary" onClick={createProject} disabled={busy}>Save + Continue</button>
            <button className="mock-btn secondary" onClick={() => setStep(form.scan_results ? "results" : "import")}>Back</button>
          </div>
        </section>
      )}

      {step === "confirm" && (
        <section className="wizard-card">
          <div className="wizard-title-row">
            <h2>Step 3: Confirm</h2>
            <span className="pill purple">S3</span>
          </div>
          <p className="wizard-desc">Final review before launching Phase 0 packet generation.</p>

          <div className="confirm-row"><span className="confirm-label">Project ID</span><span className="confirm-value">{projectId}</span></div>
          <div className="confirm-row"><span className="confirm-label">Domain</span><span className="confirm-value">{form.domain || "None"}</span></div>
          <div className="confirm-row"><span className="confirm-label">Runtime</span><span className="confirm-value">{form.runtime_mode}</span></div>
          <div className="confirm-row"><span className="confirm-label">Focus Areas</span><span className="confirm-value">{form.focus_areas.join(", ")}</span></div>

          {launchProgress.length > 0 && (
            <div className="task-progress">
              <div className="field-label">Packet Generation Progress</div>
              {launchProgress.map((task, index) => (
                <div key={`${task.created_at}-${index}`} className="task-item">
                  <span>{task.description}</span>
                  <span className={`task-status ${task.status}`}>{task.status}</span>
                </div>
              ))}
            </div>
          )}

          <div className="button-row">
            <button className="mock-btn primary" onClick={launchProject} disabled={busy}>Launch Project</button>
            <button className="mock-btn secondary" onClick={() => setStep("clarify")}>Edit</button>
          </div>
        </section>
      )}

      {step === "launched" && (
        <section className="wizard-card">
          <div className="wizard-title-row">
            <h2>Launched</h2>
            <span className="pill green">Done</span>
          </div>
          <p className="wizard-desc">Phase 0 generation started. Redirecting to inbox.</p>
        </section>
      )}
    </div>
  );
}
