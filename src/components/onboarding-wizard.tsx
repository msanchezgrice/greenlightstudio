"use client";

import { useMemo, useRef, useState } from "react";
import { onboardingSchema, scanResultSchema, type ScanResult } from "@/types/domain";

type Step = "import" | "discover" | "results" | "error" | "clarify" | "confirm" | "launched";

type UploadMeta = {
  name: string;
  size: number;
  type: string;
  last_modified: number;
};

const stepOrder: Step[] = ["import", "discover", "results", "clarify", "confirm", "launched"];
const focusSuggestions = [
  "Market Research",
  "Competitor Analysis",
  "Landing Page",
  "Logo & Brand",
  "Email Sequences",
  "Social Strategy",
  "Financial Model",
];

const allowedFileExts = [".pdf", ".ppt", ".pptx", ".doc", ".docx", ".png", ".jpg", ".jpeg"];
const maxFileSizeBytes = 10 * 1024 * 1024;

function statusClass(step: Step, target: Step) {
  const current = step === "error" ? "results" : step;
  const currentIndex = stepOrder.indexOf(current);
  const targetIndex = stepOrder.indexOf(target);
  if (currentIndex > targetIndex) return "done";
  if (currentIndex === targetIndex) return "active";
  return "upcoming";
}

function normalizeDomain(raw: string) {
  return raw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim().toLowerCase();
}

function isValidDomain(raw: string) {
  const domain = normalizeDomain(raw);
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain);
}

function normalizeRepo(raw: string) {
  return raw.trim().replace(/\.git$/i, "");
}

function isValidRepo(raw: string) {
  const normalized = normalizeRepo(raw);
  return /^https:\/\/(github\.com|gitlab\.com)\/[^/\s]+\/[^/\s]+\/?$/i.test(normalized);
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function boolLabel(value: boolean) {
  return value ? "On" : "Off";
}

export function OnboardingWizard() {
  const scanNonce = useRef(0);
  const [step, setStep] = useState<Step>("import");
  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cacheHit, setCacheHit] = useState<boolean | null>(null);
  const [launchProgress, setLaunchProgress] = useState<
    Array<{ agent: string; description: string; status: string; detail: string | null; created_at: string }>
  >([]);
  const [form, setForm] = useState({
    domain: "",
    idea_description: "",
    repo_url: "",
    uploaded_files: [] as UploadMeta[],
    runtime_mode: "attached" as "shared" | "attached",
    permissions: {
      repo_write: false,
      deploy: false,
      ads_enabled: false,
      ads_budget_cap: 0,
      email_send: false,
    },
    night_shift: true,
    focus_areas: ["Market Research", "Competitor Analysis", "Landing Page"],
    scan_results: null as ScanResult | null,
  });

  const summary = useMemo(() => {
    const scan = form.scan_results;
    const repo = scan?.repo_summary;
    const tech = scan?.tech_stack?.length ? scan.tech_stack.join(" · ") : "Unknown";
    const competitors = scan?.competitors_found?.map((item) => item.name).slice(0, 3) ?? [];
    const domainStatus =
      scan?.dns === "live" ? `${normalizeDomain(form.domain)} (LIVE)` : scan?.dns === "parked" ? `${normalizeDomain(form.domain)} (PARKED)` : "Not scanned";
    return {
      tech,
      competitors,
      domainStatus,
      repoDisplay: repo?.repo ?? (normalizeRepo(form.repo_url) || "None"),
    };
  }, [form.domain, form.repo_url, form.scan_results]);

  function ensureImportIsValid() {
    if (form.idea_description.trim().length < 20) {
      setError("Idea description must be at least 20 characters.");
      return false;
    }

    if (form.domain.trim() && !isValidDomain(form.domain)) {
      setError("Domain must be valid (for example: myproject.com).");
      return false;
    }

    if (form.repo_url.trim() && !isValidRepo(form.repo_url)) {
      setError("Repo URL must be a full GitHub or GitLab repository URL.");
      return false;
    }

    setError(null);
    return true;
  }

  function handleFileSelection(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) {
      setForm((prev) => ({ ...prev, uploaded_files: [] }));
      return;
    }

    if (files.length > 5) {
      setError("You can upload up to 5 files.");
      return;
    }

    for (const file of files) {
      const lower = file.name.toLowerCase();
      const extValid = allowedFileExts.some((ext) => lower.endsWith(ext));
      if (!extValid) {
        setError(`Unsupported file type: ${file.name}`);
        return;
      }
      if (file.size > maxFileSizeBytes) {
        setError(`File exceeds 10MB: ${file.name}`);
        return;
      }
    }

    const uploaded = files.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      last_modified: file.lastModified,
    }));

    setError(null);
    setForm((prev) => ({ ...prev, uploaded_files: uploaded }));
  }

  async function runScan() {
    if (!ensureImportIsValid()) return;

    const domain = normalizeDomain(form.domain);
    const repoUrl = normalizeRepo(form.repo_url);

    if (!domain && !repoUrl) {
      setStep("clarify");
      return;
    }

    setBusy(true);
    setCacheHit(null);
    setStep("discover");
    setError(null);
    const nonce = ++scanNonce.current;

    try {
      const startedAt = Date.now();
      const res = await fetch("/api/onboarding/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: domain || null,
          repo_url: repoUrl || null,
          idea_description: form.idea_description,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Scan failed");

      const elapsed = Date.now() - startedAt;
      if (elapsed < 900) {
        await new Promise((resolve) => setTimeout(resolve, 900 - elapsed));
      }
      if (nonce !== scanNonce.current) return;

      const parsed = scanResultSchema.parse(json);
      setCacheHit(Boolean(json.cache_hit));
      setForm((prev) => ({ ...prev, scan_results: parsed }));

      const hasUsableData =
        parsed.dns !== null ||
        parsed.http_status !== null ||
        Boolean(parsed.repo_summary && !parsed.repo_summary.error) ||
        parsed.competitors_found.length > 0;

      setStep(parsed.error && !hasUsableData ? "error" : "results");
    } catch (err) {
      if (nonce !== scanNonce.current) return;
      setError(err instanceof Error ? err.message : "Scan failed");
      setStep("error");
    } finally {
      if (nonce !== scanNonce.current) return;
      setBusy(false);
    }
  }

  async function createProject(): Promise<string> {
    const payload = onboardingSchema.parse({
      ...form,
      domain: form.domain.trim() ? normalizeDomain(form.domain) : null,
      repo_url: form.repo_url.trim() ? normalizeRepo(form.repo_url) : null,
      focus_areas: form.focus_areas.filter(Boolean),
    });

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Project creation failed");
    if (!json.projectId) throw new Error("Project creation did not return an ID");
    return json.projectId as string;
  }

  async function launchProject() {
    if (!ensureImportIsValid()) return;
    if (!form.focus_areas.length) {
      setError("Select at least one focus area.");
      return;
    }

    setBusy(true);
    setError(null);
    setLaunchProgress([]);

    try {
      const id = projectId ?? (await createProject());
      setProjectId(id);

      const pollProgress = async () => {
        const progressRes = await fetch(`/api/projects/${id}/progress`, { cache: "no-store" });
        if (!progressRes.ok) return;
        const progressJson = await progressRes.json();
        setLaunchProgress(progressJson.tasks ?? []);
      };

      await pollProgress();

      let finished = false;
      let launchError: Error | null = null;
      const launchRequest = fetch(`/api/projects/${id}/launch`, { method: "POST" })
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
        window.location.href = `/projects/${id}/packet`;
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Launch failed");
    } finally {
      setBusy(false);
    }
  }

  const scan = form.scan_results;
  const domainStatus = scan?.dns ?? null;
  const competitors = scan?.competitors_found ?? [];
  const repoSummary = scan?.repo_summary ?? null;
  const hasScanResults = Boolean(scan && !scan.error);

  return (
    <div className="wizard-shell">
      <div className="wizard-progress">
        <div className={`step ${statusClass(step, "import")}`}>Import</div>
        <div className={`step ${statusClass(step, "discover")}`}>Discover</div>
        <div className={`step ${statusClass(step, "results")}`}>Scan Results</div>
        <div className={`step ${statusClass(step, "clarify")}`}>Clarify</div>
        <div className={`step ${statusClass(step, "confirm")}`}>Confirm</div>
      </div>

      {error && <div className="wizard-error">{error}</div>}

      {step === "import" && (
        <section className="wizard-card">
          <div className="wizard-title-row">
            <h2>What are you building?</h2>
            <span className="pill cyan">S0</span>
          </div>
          <p className="wizard-desc">
            Drop in a domain, paste a repo URL, or just describe your idea. We will take it from there.
          </p>

          <label className="field-label">Domain Name (optional)</label>
          <input
            className="mock-input"
            placeholder="offlinedad.com"
            value={form.domain}
            onChange={(event) => setForm((prev) => ({ ...prev, domain: event.target.value }))}
          />

          <label className="field-label">Describe Your Idea (required)</label>
          <textarea
            className="mock-textarea"
            value={form.idea_description}
            placeholder="Parenting app for dads who want to disconnect from screens and be more present with their kids..."
            onChange={(event) => setForm((prev) => ({ ...prev, idea_description: event.target.value }))}
          />

          <label className="field-label">GitHub/GitLab Repo (optional)</label>
          <input
            className="mock-input"
            placeholder="https://github.com/user/repo"
            value={form.repo_url}
            onChange={(event) => setForm((prev) => ({ ...prev, repo_url: event.target.value }))}
          />

          <label className="field-label">Upload Files (optional)</label>
          <label className="upload-box">
            <input
              type="file"
              multiple
              accept=".pdf,.ppt,.pptx,.doc,.docx,.png,.jpg,.jpeg"
              onChange={(event) => handleFileSelection(event.target.files)}
            />
            <span>Drop pitch deck, wireframes, or docs here</span>
            <span className="upload-note">PDF, PPTX, DOCX, images · max 5 files · 10MB each</span>
          </label>

          {form.uploaded_files.length > 0 && (
            <div className="file-list">
              {form.uploaded_files.map((file) => (
                <div key={`${file.name}-${file.last_modified}`} className="file-item">
                  <span>{file.name}</span>
                  <span>{formatBytes(file.size)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="button-row">
            <button className="mock-btn primary" onClick={runScan} disabled={busy}>
              Scan &amp; Discover →
            </button>
            <button
              className="mock-btn secondary"
              onClick={() => {
                if (!ensureImportIsValid()) return;
                setStep("clarify");
              }}
              disabled={busy}
            >
              Skip scan, go to settings →
            </button>
          </div>
          <p className="field-note">Scanning checks your domain and repo in read-only mode. No changes are made.</p>
        </section>
      )}

      {step === "discover" && (
        <section className="wizard-card">
          <div className="wizard-title-row">
            <h2>Scanning Your Assets…</h2>
            <span className="pill green">S1</span>
          </div>
          <p className="wizard-desc">Running Pre-Phase 0 asset discovery. This usually takes 10-30 seconds.</p>

          <div className="loading-bar">
            <div className="fill" />
          </div>

          <div className="scan-list">
            <div className="scan-result">
              <div className="scan-icon live">✓</div>
              <div className="scan-main">
                <div className="scan-label">DNS Lookup</div>
                <div className="scan-sub">{form.domain ? normalizeDomain(form.domain) : "No domain supplied"}</div>
              </div>
              <div className="scan-badge live">{form.domain ? "RUNNING" : "SKIPPED"}</div>
            </div>
            <div className="scan-result">
              <div className="scan-icon live">✓</div>
              <div className="scan-main">
                <div className="scan-label">HTTP Probe</div>
                <div className="scan-sub">{form.domain ? "Checking status, TLS, and redirects" : "No domain supplied"}</div>
              </div>
              <div className="scan-badge live">{form.domain ? "RUNNING" : "SKIPPED"}</div>
            </div>
            <div className="scan-result">
              <div className="scan-icon repo">⟳</div>
              <div className="scan-main">
                <div className="scan-label">Repository Scan</div>
                <div className="scan-sub">{form.repo_url ? normalizeRepo(form.repo_url) : "No repository supplied"}</div>
              </div>
              <div className="scan-badge found">{form.repo_url ? "RUNNING" : "SKIPPED"}</div>
            </div>
            <div className="scan-result">
              <div className="scan-icon repo">⟳</div>
              <div className="scan-main">
                <div className="scan-label">Competitor Quick-Scan</div>
                <div className="scan-sub">Searching top similar products and domains</div>
              </div>
              <div className="scan-badge found">RUNNING</div>
            </div>
          </div>

          <div className="button-row">
            <button
              className="mock-btn secondary"
              onClick={() => {
                scanNonce.current += 1;
                setBusy(false);
                setStep("clarify");
              }}
            >
              Skip scan →
            </button>
          </div>
        </section>
      )}

      {step === "results" && (
        <section className="wizard-card">
          <div className="wizard-title-row">
            <h2>Here Is What We Found</h2>
            <span className="pill blue">S1.5</span>
          </div>
          <p className="wizard-desc">Review discovery results. We will use this context in your Phase 0 packet.</p>

          {cacheHit !== null && <p className="field-note">{cacheHit ? "Cached scan result (24h cache)." : "Fresh scan result."}</p>}

          {domainStatus === "live" && (
            <div className="success-state">
              <p className="success-text">
                {normalizeDomain(form.domain)} is LIVE. Existing site context will be included in packet generation.
              </p>
            </div>
          )}
          {domainStatus === "parked" && (
            <div className="warning-state">
              <p className="warning-text">
                {normalizeDomain(form.domain)} appears parked. We found no real product content, but the domain exists.
              </p>
            </div>
          )}
          {domainStatus === "none" && form.domain.trim() && (
            <div className="warning-state">
              <p className="warning-text">Domain did not resolve as a live site. You can still continue with idea-only context.</p>
            </div>
          )}

          <div className="scan-list">
            {form.domain.trim() && (
              <div className="scan-result">
                <div className={`scan-icon ${domainStatus === "live" ? "live" : domainStatus === "parked" ? "parked" : "none"}`}>
                  {domainStatus === "live" ? "🌐" : domainStatus === "parked" ? "P" : "○"}
                </div>
                <div className="scan-main">
                  <div className="scan-label">{normalizeDomain(form.domain)}</div>
                  <div className="scan-sub">
                    {scan?.meta?.title || "No title found"}
                    {scan?.http_status ? ` · HTTP ${scan.http_status}` : ""}
                  </div>
                </div>
                <div className={`scan-badge ${domainStatus === "live" ? "live" : domainStatus === "parked" ? "parked" : "none"}`}>
                  {domainStatus?.toUpperCase() || "UNKNOWN"}
                </div>
              </div>
            )}

            {repoSummary && (
              <div className="scan-result">
                <div className="scan-icon repo">📦</div>
                <div className="scan-main">
                  <div className="scan-label">{repoSummary.repo || normalizeRepo(form.repo_url)}</div>
                  <div className="scan-sub">
                    {repoSummary.language || "Unknown language"}
                    {repoSummary.framework ? ` · ${repoSummary.framework}` : ""}
                    {repoSummary.last_commit ? ` · updated ${new Date(repoSummary.last_commit).toLocaleDateString()}` : ""}
                  </div>
                </div>
                <div className="scan-badge found">{repoSummary.error ? "PARTIAL" : "SCANNED"}</div>
              </div>
            )}

            <div className="scan-result">
              <div className="scan-icon repo">🏷</div>
              <div className="scan-main">
                <div className="scan-label">Tech Stack</div>
                <div className="scan-sub">{summary.tech}</div>
              </div>
            </div>

            <div className="scan-result">
              <div className="scan-icon parked">⚔</div>
              <div className="scan-main">
                <div className="scan-label">Competitors Found</div>
                <div className="scan-sub">
                  {competitors.length ? competitors.map((entry) => entry.name).slice(0, 5).join(", ") : "No competitors discovered"}
                </div>
              </div>
              <div className="scan-badge parked">{competitors.length}</div>
            </div>
          </div>

          {repoSummary?.key_files?.length ? (
            <div className="repo-tree">
              {repoSummary.key_files.map((file) => (
                <div key={file}>├── {file}</div>
              ))}
            </div>
          ) : null}

          {scan?.error && <p className="field-note">Partial scan note: {scan.error}</p>}

          <div className="button-row">
            <button className="mock-btn primary" onClick={() => setStep("clarify")}>
              Looks good → Configure
            </button>
            <button className="mock-btn secondary" onClick={() => setStep("import")}>
              ← Edit inputs
            </button>
            {repoSummary && (
              <button
                className="mock-btn secondary"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    repo_url: "",
                    scan_results: prev.scan_results
                      ? {
                          ...prev.scan_results,
                          repo_summary: null,
                        }
                      : null,
                  }))
                }
              >
                Remove repo
              </button>
            )}
          </div>
        </section>
      )}

      {step === "error" && (
        <section className="wizard-card">
          <div className="wizard-title-row">
            <h2>Scan Could Not Complete</h2>
            <span className="pill red">S1.5e</span>
          </div>
          <p className="wizard-desc">Scanning is optional. You can continue without it.</p>
          <div className="warning-state">
            <p className="warning-text">{scan?.error ?? error ?? "Unknown scan error"}</p>
          </div>
          <div className="button-row">
            <button className="mock-btn primary" onClick={() => setStep("clarify")}>
              Continue without scan →
            </button>
            <button className="mock-btn secondary" onClick={runScan} disabled={busy}>
              Retry scan
            </button>
            <button className="mock-btn secondary" onClick={() => setStep("import")}>
              ← Edit inputs
            </button>
          </div>
        </section>
      )}

      {step === "clarify" && (
        <section className="wizard-card">
          <div className="wizard-title-row">
            <h2>How should we operate?</h2>
            <span className="pill yellow">S2</span>
          </div>
          <p className="wizard-desc">Set runtime mode, permission controls, and focus areas for your CEO agent.</p>

          <label className="field-label">Runtime Mode</label>
          <div className="radio-group">
            <button
              className={`mock-radio ${form.runtime_mode === "attached" ? "selected" : ""}`}
              onClick={() => setForm((prev) => ({ ...prev, runtime_mode: "attached" }))}
              type="button"
            >
              <span className="mock-radio-dot" />
              <span>
                <span className="mock-radio-label">Mode B: Attached to your repo</span>
                <span className="mock-radio-desc">
                  Agents read your code and open PRs. You approve merges. Recommended for existing codebases.
                </span>
              </span>
            </button>
            <button
              className={`mock-radio ${form.runtime_mode === "shared" ? "selected" : ""}`}
              onClick={() => setForm((prev) => ({ ...prev, runtime_mode: "shared" }))}
              type="button"
            >
              <span className="mock-radio-dot" />
              <span>
                <span className="mock-radio-label">Mode A: Shared runtime</span>
                <span className="mock-radio-desc">
                  We host your landing pages and assets. Best for new ideas with no existing code.
                </span>
              </span>
            </button>
          </div>

          <label className="field-label">Permissions (safe by default)</label>
          <div className="toggle-stack">
            <button
              type="button"
              className="mock-toggle-btn"
              onClick={() =>
                setForm((prev) => ({ ...prev, permissions: { ...prev.permissions, repo_write: !prev.permissions.repo_write } }))
              }
            >
              <span className={`toggle-track ${form.permissions.repo_write ? "on" : ""}`}>
                <span className="toggle-dot" />
              </span>
              <span className="toggle-label">Repo write access (PRs only, never push to main)</span>
            </button>
            <button
              type="button"
              className="mock-toggle-btn"
              onClick={() => setForm((prev) => ({ ...prev, permissions: { ...prev.permissions, deploy: !prev.permissions.deploy } }))}
            >
              <span className={`toggle-track ${form.permissions.deploy ? "on" : ""}`}>
                <span className="toggle-dot" />
              </span>
              <span className="toggle-label">Deploy permission (staging only)</span>
            </button>
            <button
              type="button"
              className="mock-toggle-btn"
              onClick={() =>
                setForm((prev) => ({ ...prev, permissions: { ...prev.permissions, email_send: !prev.permissions.email_send } }))
              }
            >
              <span className={`toggle-track ${form.permissions.email_send ? "on" : ""}`}>
                <span className="toggle-dot" />
              </span>
              <span className="toggle-label">Send emails (transactional only)</span>
            </button>
            <button
              type="button"
              className="mock-toggle-btn"
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  permissions: {
                    ...prev.permissions,
                    ads_enabled: !prev.permissions.ads_enabled,
                    ads_budget_cap: !prev.permissions.ads_enabled ? Math.max(prev.permissions.ads_budget_cap, 10) : 0,
                  },
                }))
              }
            >
              <span className={`toggle-track ${form.permissions.ads_enabled ? "on" : ""}`}>
                <span className="toggle-dot" />
              </span>
              <span className="toggle-label">Ad spend (requires budget cap)</span>
            </button>
          </div>

          <label className="field-label">Budget Cap (if ads enabled)</label>
          <input
            className="mock-input"
            type="number"
            min={0}
            disabled={!form.permissions.ads_enabled}
            value={form.permissions.ads_budget_cap}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                permissions: {
                  ...prev.permissions,
                  ads_budget_cap: Math.max(0, Number(event.target.value) || 0),
                },
              }))
            }
          />

          <label className="field-label">Night Shift</label>
          <button
            type="button"
            className="mock-toggle-btn"
            onClick={() => setForm((prev) => ({ ...prev, night_shift: !prev.night_shift }))}
          >
            <span className={`toggle-track ${form.night_shift ? "on" : ""}`}>
              <span className="toggle-dot" />
            </span>
            <span className="toggle-label">Enable autonomous night shift cycles</span>
          </button>
          <p className="field-note">
            CEO agent runs nightly cycles, creates tasks, and writes a while-you-were-away report.
          </p>

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
                      focus_areas: selected ? prev.focus_areas.filter((entry) => entry !== focus) : [...prev.focus_areas, focus],
                    }))
                  }
                >
                  {selected ? "✓ " : ""}
                  {focus}
                </button>
              );
            })}
          </div>

          <div className="button-row">
            <button className="mock-btn primary" onClick={() => setStep("confirm")} disabled={busy}>
              Review &amp; Launch →
            </button>
            <button className="mock-btn secondary" onClick={() => setStep(hasScanResults ? "results" : "import")} disabled={busy}>
              ← Back
            </button>
          </div>
        </section>
      )}

      {step === "confirm" && (
        <section className="wizard-card">
          <div className="wizard-title-row">
            <h2>Ready to launch?</h2>
            <span className="pill purple">S3</span>
          </div>
          <p className="wizard-desc">Review setup. Click any row to edit.</p>

          <button type="button" className="confirm-row interactive" onClick={() => setStep("import")}>
            <span className="confirm-label">Project Seed</span>
            <span className="confirm-value">{form.idea_description.slice(0, 55)}{form.idea_description.length > 55 ? "…" : ""}</span>
          </button>
          <button type="button" className="confirm-row interactive" onClick={() => setStep("import")}>
            <span className="confirm-label">Domain</span>
            <span className={`confirm-value ${domainStatus === "live" ? "green" : domainStatus === "parked" ? "yellow" : ""}`}>
              {summary.domainStatus}
            </span>
          </button>
          <button type="button" className="confirm-row interactive" onClick={() => setStep("import")}>
            <span className="confirm-label">Repository</span>
            <span className="confirm-value blue">{summary.repoDisplay}</span>
          </button>
          <button type="button" className="confirm-row interactive" onClick={() => setStep("results")}>
            <span className="confirm-label">Tech Stack</span>
            <span className="confirm-value">{summary.tech}</span>
          </button>
          <button type="button" className="confirm-row interactive" onClick={() => setStep("clarify")}>
            <span className="confirm-label">Runtime Mode</span>
            <span className="confirm-value blue">
              {form.runtime_mode === "attached" ? "Attached (PRs to your repo)" : "Shared runtime"}
            </span>
          </button>
          <button type="button" className="confirm-row interactive" onClick={() => setStep("clarify")}>
            <span className="confirm-label">Repo Write</span>
            <span className={`confirm-value ${form.permissions.repo_write ? "green" : ""}`}>{boolLabel(form.permissions.repo_write)}</span>
          </button>
          <button type="button" className="confirm-row interactive" onClick={() => setStep("clarify")}>
            <span className="confirm-label">Deploy</span>
            <span className={`confirm-value ${form.permissions.deploy ? "green" : ""}`}>{boolLabel(form.permissions.deploy)}</span>
          </button>
          <button type="button" className="confirm-row interactive" onClick={() => setStep("clarify")}>
            <span className="confirm-label">Email</span>
            <span className={`confirm-value ${form.permissions.email_send ? "green" : ""}`}>{boolLabel(form.permissions.email_send)}</span>
          </button>
          <button type="button" className="confirm-row interactive" onClick={() => setStep("clarify")}>
            <span className="confirm-label">Ad Budget</span>
            <span className="confirm-value yellow">
              {form.permissions.ads_enabled ? `$${form.permissions.ads_budget_cap}/day` : "$0/day"}
            </span>
          </button>
          <button type="button" className="confirm-row interactive" onClick={() => setStep("clarify")}>
            <span className="confirm-label">Night Shift</span>
            <span className={`confirm-value ${form.night_shift ? "green" : ""}`}>{form.night_shift ? "Enabled" : "Disabled"}</span>
          </button>
          <button type="button" className="confirm-row interactive" onClick={() => setStep("clarify")}>
            <span className="confirm-label">Focus Areas</span>
            <span className="confirm-value">{form.focus_areas.join(", ")}</span>
          </button>
          <button type="button" className="confirm-row interactive" onClick={() => setStep("results")}>
            <span className="confirm-label">Competitors Found</span>
            <span className="confirm-value yellow">
              {summary.competitors.length ? `${summary.competitors.length} (${summary.competitors.join(", ")})` : "0"}
            </span>
          </button>

          <div className="next-box">
            <div className="next-box-title">What happens next</div>
            <div className="next-box-text">
              Your CEO agent begins Phase 0 immediately: competitor research, market sizing, and packet synthesis.
              {form.night_shift ? " Night shift will run automatically tonight." : " Night shift is disabled for now."}
            </div>
          </div>

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
            <button className="mock-btn primary launch" onClick={launchProject} disabled={busy}>
              {busy ? "Launching…" : "Launch Project"}
            </button>
            <button className="mock-btn secondary" onClick={() => setStep("clarify")} disabled={busy}>
              ← Edit
            </button>
          </div>
        </section>
      )}

      {step === "launched" && (
        <section className="wizard-card">
          <div className="wizard-title-row">
            <h2>Project Launched</h2>
            <span className="pill green">Done</span>
          </div>
          <p className="wizard-desc">Phase 0 generation started. Redirecting to your project workspace…</p>
        </section>
      )}
    </div>
  );
}
