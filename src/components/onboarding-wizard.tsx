"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { onboardingSchema, scanResultSchema, type ScanResult } from "@/types/domain";
import { createBrowserSupabase } from "@/lib/supabase-browser";

type Step = "import" | "discover" | "results" | "error" | "clarify" | "confirm" | "launched";

type ScanItemStatus = "queued" | "running" | "done" | "skipped";

type GitHubConnection = {
  connected: boolean;
  username?: string;
  avatar_url?: string;
};

type UploadMeta = {
  name: string;
  size: number;
  type: string;
  last_modified: number;
};

type LaunchTask = {
  agent: string;
  description: string;
  status: string;
  detail: string | null;
  created_at: string;
};

type StoredWizardState = {
  step?: Step;
  projectId?: string | null;
  projectIds?: string[];
  cacheHit?: boolean | null;
  form?: Partial<typeof defaultForm>;
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
const wizardStorageKey = "greenlight_onboarding_wizard_v1";
const wizardSessionStorageKey = `${wizardStorageKey}_session`;
const domainSeparatorPattern = /[\n,;]+/;

const defaultForm = {
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
};

type FormState = typeof defaultForm;

function createInitialForm(): FormState {
  return {
    ...defaultForm,
    uploaded_files: [] as UploadMeta[],
    permissions: { ...defaultForm.permissions },
    focus_areas: [...defaultForm.focus_areas],
    scan_results: null as ScanResult | null,
  };
}

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

function parseDomains(raw: string) {
  return Array.from(
    new Set(
      raw
        .split(domainSeparatorPattern)
        .map((entry) => normalizeDomain(entry))
        .filter(Boolean),
    ),
  );
}

function listInvalidDomains(raw: string) {
  return parseDomains(raw).filter((domain) => !isValidDomain(domain));
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

function readStorage(key: string, storage: Storage) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, storage: Storage, payload: string) {
  try {
    storage.setItem(key, payload);
  } catch {
    // Ignore storage quota or privacy mode errors.
  }
}

function removeStorage(key: string, storage: Storage) {
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage quota or privacy mode errors.
  }
}

function parseStoredWizardState(raw: string | null): StoredWizardState | null {
  if (!raw?.trim()) return null;
  try {
    return JSON.parse(raw) as StoredWizardState;
  } catch {
    return null;
  }
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

function normalizeLaunchTasks(tasks: LaunchTask[], launchStartedAt: number) {
  const threshold = launchStartedAt - 5_000;
  const ordered = tasks
    .filter((task) => {
      const createdAt = Date.parse(task.created_at);
      return Number.isFinite(createdAt) && createdAt >= threshold;
    })
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));

  const attemptStarts = ordered
    .filter((task) => task.description === "phase0_init")
    .map((task) => Date.parse(task.created_at))
    .filter((value) => Number.isFinite(value));
  const attemptStart = attemptStarts.length ? Math.max(...attemptStarts) : threshold;

  const latestByDescription = new Map<string, LaunchTask>();
  for (const task of ordered) {
    const createdAt = Date.parse(task.created_at);
    if (createdAt < attemptStart) continue;
    latestByDescription.set(task.description, task);
  }

  return Array.from(latestByDescription.values()).sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
}

export function OnboardingWizard() {
  const { isSignedIn } = useAuth();
  const searchParams = useSearchParams();
  const restoredRef = useRef(false);
  const scanNonce = useRef(0);
  const launchNonce = useRef(0);
  const [step, setStep] = useState<Step>("import");
  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cacheHit, setCacheHit] = useState<boolean | null>(null);
  const [launchProgress, setLaunchProgress] = useState<LaunchTask[]>([]);
  const [launchElapsed, setLaunchElapsed] = useState(0);
  const [form, setForm] = useState<FormState>(createInitialForm);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [scanItemStatuses, setScanItemStatuses] = useState<ScanItemStatus[]>(["queued", "queued", "queued", "queued", "queued"]);
  const [githubConnection, setGithubConnection] = useState<GitHubConnection>({ connected: false });
  const [githubLoading, setGithubLoading] = useState(false);
  const resetRequested = searchParams.get("new") === "1";
  const githubConnectParam = searchParams.get("github");

  useEffect(() => {
    try {
      if (resetRequested) {
        removeStorage(wizardStorageKey, window.localStorage);
        removeStorage(wizardSessionStorageKey, window.sessionStorage);
        setStep("import");
        setProjectId(null);
        setProjectIds([]);
        setCacheHit(null);
        setLaunchProgress([]);
        setSelectedFiles([]);
        setForm(createInitialForm());
        setError(null);

        const url = new URL(window.location.href);
        if (url.searchParams.has("new")) {
          url.searchParams.delete("new");
          window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
        }

        restoredRef.current = true;
        return;
      }

      const stored =
        parseStoredWizardState(readStorage(wizardStorageKey, window.localStorage)) ??
        parseStoredWizardState(readStorage(wizardSessionStorageKey, window.sessionStorage));
      if (!stored) {
        restoredRef.current = true;
        return;
      }

      if (stored.form) {
        const baseForm = createInitialForm();
        setForm({
          ...baseForm,
          ...stored.form,
          permissions: {
            ...baseForm.permissions,
            ...(stored.form.permissions ?? {}),
          },
          focus_areas:
            stored.form.focus_areas && stored.form.focus_areas.length
              ? stored.form.focus_areas
              : baseForm.focus_areas,
        });
      }

      if (stored.step && stepOrder.includes(stored.step)) {
        setStep(stored.step);
      }

      if (typeof stored.projectId === "string" || stored.projectId === null) {
        setProjectId(stored.projectId ?? null);
      }

      if (Array.isArray(stored.projectIds)) {
        setProjectIds(stored.projectIds.filter((entry): entry is string => typeof entry === "string"));
      }

      if (typeof stored.cacheHit === "boolean" || stored.cacheHit === null) {
        setCacheHit(stored.cacheHit ?? null);
      }
    } catch {
      // Ignore corrupted local wizard state and continue with defaults.
    } finally {
      restoredRef.current = true;
    }
  }, [resetRequested]);

  useEffect(() => {
    if (!restoredRef.current) return;

    const payload = {
      step,
      projectId,
      projectIds,
      cacheHit,
      form,
    };

    const serialized = JSON.stringify(payload);
    writeStorage(wizardStorageKey, window.localStorage, serialized);
    writeStorage(wizardSessionStorageKey, window.sessionStorage, serialized);
  }, [step, projectId, projectIds, cacheHit, form]);

  // Check GitHub connection status on mount and after OAuth callback
  const checkGitHubConnection = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/github/status");
      if (res.ok) {
        const data = await res.json() as GitHubConnection;
        setGithubConnection(data);
      }
    } catch {
      // Silently fail - GitHub connection is optional
    }
  }, []);

  useEffect(() => {
    if (isSignedIn) {
      checkGitHubConnection();
    }
  }, [isSignedIn, checkGitHubConnection]);

  useEffect(() => {
    if (githubConnectParam === "connected") {
      checkGitHubConnection();
      // Clean up URL param
      const url = new URL(window.location.href);
      url.searchParams.delete("github");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [githubConnectParam, checkGitHubConnection]);

  // Animate scan items progressively when in discover step
  useEffect(() => {
    if (step !== "discover") {
      setScanItemStatuses(["queued", "queued", "queued", "queued", "queued"]);
      return;
    }

    const hasDomain = Boolean(primaryDomain);
    const hasRepo = Boolean(form.repo_url.trim());

    // Build scan item list with skip logic
    const targetStatuses: ScanItemStatus[] = [
      hasDomain ? "done" : "skipped", // DNS Lookup
      hasDomain ? "done" : "skipped", // HTTP Probe
      hasDomain ? "done" : "skipped", // Meta & Content Scrape
      hasRepo ? "done" : "skipped",   // Repository Scan
      "done",                          // Competitor Quick-Scan
    ];

    // Set initial state: first applicable item running, rest queued
    const initial: ScanItemStatus[] = targetStatuses.map((target, i) => {
      if (target === "skipped") return "skipped";
      if (i === 0 || targetStatuses.slice(0, i).every(s => s === "skipped")) return "running";
      return "queued";
    });
    setScanItemStatuses(initial);

    // Progressively animate items to done
    const timers: ReturnType<typeof setTimeout>[] = [];
    let delay = 800;
    const nonSkippedIndices = targetStatuses
      .map((s, i) => (s !== "skipped" ? i : -1))
      .filter(i => i >= 0);

    nonSkippedIndices.forEach((itemIndex, seqIndex) => {
      const completeTimer = setTimeout(() => {
        setScanItemStatuses(prev => {
          const next = [...prev];
          next[itemIndex] = "done";
          // Start next non-skipped item
          const nextItem = nonSkippedIndices[seqIndex + 1];
          if (nextItem !== undefined) {
            next[nextItem] = "running";
          }
          return next;
        });
      }, delay);
      timers.push(completeTimer);
      delay += 600 + Math.random() * 800;
    });

    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const parsedDomains = useMemo(() => parseDomains(form.domain), [form.domain]);
  const primaryDomain = parsedDomains[0] ?? "";
  const additionalDomains = parsedDomains.slice(1);

  const summary = useMemo(() => {
    const scan = form.scan_results;
    const repo = scan?.repo_summary;
    const tech = scan?.tech_stack?.length ? scan.tech_stack.join(" · ") : "Unknown";
    const competitors = scan?.competitors_found?.map((item) => item.name).slice(0, 3) ?? [];
    const domainDisplay = primaryDomain ? (additionalDomains.length ? `${primaryDomain} (+${additionalDomains.length} more)` : primaryDomain) : "";
    const domainStatus =
      scan?.dns === "live"
        ? `${domainDisplay} (LIVE)`
        : scan?.dns === "parked"
          ? `${domainDisplay} (PARKED)`
          : domainDisplay || "Not scanned";
    const ideaText = form.idea_description.trim();
    const repoDisplay = repo?.repo ?? (normalizeRepo(form.repo_url) || "None");
    const projectSeed = ideaText
      ? ideaText
      : primaryDomain
        ? `Seeded from domain ${primaryDomain}.`
        : repoDisplay !== "None"
          ? `Seeded from repository ${repoDisplay}.`
          : "No seed provided.";
    return {
      tech,
      competitors,
      domainStatus,
      repoDisplay,
      projectSeed,
    };
  }, [additionalDomains.length, form.idea_description, form.repo_url, form.scan_results, primaryDomain]);

  function ensureDomainRepoShapeIsValid() {
    if (parsedDomains.length > 10) {
      setError("You can add up to 10 domains.");
      return false;
    }

    const invalidDomains = listInvalidDomains(form.domain);
    if (invalidDomains.length) {
      setError(`Invalid domain${invalidDomains.length > 1 ? "s" : ""}: ${invalidDomains.join(", ")}`);
      return false;
    }

    if (form.repo_url.trim() && !isValidRepo(form.repo_url)) {
      setError("Repo URL must be a full GitHub or GitLab repository URL.");
      return false;
    }

    return true;
  }

  function ensureProjectSeedIsValid() {
    const hasDomain = parsedDomains.length > 0;
    const hasRepo = Boolean(form.repo_url.trim());
    const hasIdea = form.idea_description.trim().length >= 20;
    if (!hasDomain && !hasRepo && !hasIdea) {
      setError("Provide at least one domain, repository URL, or an idea description with 20+ characters.");
      return false;
    }
    return true;
  }

  function ensureScanIsValid() {
    if (!ensureDomainRepoShapeIsValid()) {
      return false;
    }

    if (!parsedDomains.length && !form.repo_url.trim()) {
      setError("Add a domain or repository URL to run discovery scan.");
      return false;
    }

    setError(null);
    return true;
  }

  function ensureClarifyEntryIsValid() {
    if (!ensureDomainRepoShapeIsValid()) {
      return false;
    }
    if (!ensureProjectSeedIsValid()) {
      return false;
    }
    setError(null);
    return true;
  }

  function ensureLaunchIsValid() {
    if (!ensureDomainRepoShapeIsValid()) {
      return false;
    }

    if (!ensureProjectSeedIsValid()) {
      return false;
    }

    if (!isSignedIn) {
      setError("Sign in is required to launch and save your project.");
      return false;
    }

    setError(null);
    return true;
  }

  async function parseResponseJson(response: Response) {
    const raw = await response.text();
    if (!raw.trim()) return null;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  function handleFileSelection(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) {
      setSelectedFiles([]);
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
    setSelectedFiles(files);
    setForm((prev) => ({ ...prev, uploaded_files: uploaded }));
  }

  async function uploadSelectedFiles(projectIdValue: string) {
    if (!selectedFiles.length) return;

    const supabase = createBrowserSupabase();
    for (const file of selectedFiles) {
      const urlRes = await fetch(`/api/projects/${projectIdValue}/assets/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          type: file.type || "application/octet-stream",
          last_modified: file.lastModified,
        }),
      });
      const urlJson = await parseResponseJson(urlRes);
      if (!urlRes.ok || !urlJson) {
        const message = typeof urlJson?.error === "string" ? urlJson.error : `Upload URL failed (HTTP ${urlRes.status})`;
        throw new Error(message);
      }

      const bucket = typeof urlJson.bucket === "string" ? urlJson.bucket : null;
      const path = typeof urlJson.path === "string" ? urlJson.path : null;
      const token = typeof urlJson.token === "string" ? urlJson.token : null;
      const assetId = typeof urlJson.assetId === "string" ? urlJson.assetId : null;
      if (!bucket || !path || !token || !assetId) {
        throw new Error("Upload URL response is missing required fields.");
      }

      const uploadResult = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, file);
      if (uploadResult.error) {
        throw new Error(`File upload failed (${file.name}): ${uploadResult.error.message}`);
      }

      const completeRes = await fetch(`/api/projects/${projectIdValue}/assets/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId }),
      });
      const completeJson = await parseResponseJson(completeRes);
      if (!completeRes.ok) {
        const message = typeof completeJson?.error === "string" ? completeJson.error : `Upload completion failed (HTTP ${completeRes.status})`;
        throw new Error(message);
      }
    }
  }

  async function runScan() {
    if (!ensureScanIsValid()) return;

    const domain = primaryDomain;
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
      const json = await parseResponseJson(res);

      if (!res.ok) {
        const message = typeof json?.error === "string" ? json.error : `Scan failed (HTTP ${res.status})`;
        throw new Error(message);
      }
      if (!json) throw new Error("Scan failed: empty server response.");

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

  async function createProjects(): Promise<string[]> {
    const payload = onboardingSchema.parse({
      ...form,
      domain: primaryDomain || null,
      domains: parsedDomains,
      repo_url: form.repo_url.trim() ? normalizeRepo(form.repo_url) : null,
      focus_areas: form.focus_areas.filter(Boolean),
    });

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await parseResponseJson(res);

    if (!res.ok) {
      if (res.status === 401 || res.status === 403 || res.status === 405) {
        throw new Error("Sign in is required to launch and save your project.");
      }
      const errorMessage = typeof json?.error === "string" ? json.error : `Project creation failed (HTTP ${res.status})`;
      throw new Error(errorMessage);
    }

    const returnedProjectIds = Array.isArray(json?.projectIds)
      ? json.projectIds.filter((entry): entry is string => typeof entry === "string")
      : [];
    const fallbackProjectId = typeof json?.projectId === "string" ? [json.projectId] : [];
    const projectIdsFromApi = returnedProjectIds.length ? returnedProjectIds : fallbackProjectId;

    if (!projectIdsFromApi.length) {
      throw new Error("Project creation returned an invalid response.");
    }

    return projectIdsFromApi;
  }

  async function launchProject() {
    if (!ensureLaunchIsValid()) return;
    if (!form.focus_areas.length) {
      setError("Select at least one focus area.");
      return;
    }

    setBusy(true);
    setError(null);
    setLaunchProgress([]);
    setLaunchElapsed(0);

    try {
      const createdIds = projectId ? (projectIds.length ? projectIds : [projectId]) : await createProjects();
      const primaryProjectId = createdIds[0];
      setProjectId(primaryProjectId);
      setProjectIds(createdIds);

      if (form.uploaded_files.length > 0 && selectedFiles.length === 0 && !projectId) {
        throw new Error("Please reselect files before launch. Browser security clears file handles after refresh.");
      }
      if (selectedFiles.length > 0) {
        for (const uploadProjectId of createdIds) {
          await uploadSelectedFiles(uploadProjectId);
        }
      }

      const secondaryProjectIds = createdIds.slice(1);

      // Fire launch request and confirm it was accepted
      const launchRes = await fetch(`/api/projects/${primaryProjectId}/launch`, {
        method: "POST",
      });
      const launchJson = await parseResponseJson(launchRes);

      if (!launchRes.ok) {
        const errorMessage = typeof launchJson?.error === "string" ? launchJson.error : `Launch failed (HTTP ${launchRes.status})`;
        throw new Error(errorMessage);
      }
      if (launchJson?.alreadyRunning) {
        throw new Error("A launch is already in progress. Please wait for it to complete, then refresh.");
      }

      // Fire secondary launches (best effort)
      for (const secondaryProjectId of secondaryProjectIds) {
        fetch(`/api/projects/${secondaryProjectId}/launch`, { method: "POST", keepalive: true }).catch(() => {});
      }

      try {
        removeStorage(wizardStorageKey, window.localStorage);
        removeStorage(wizardSessionStorageKey, window.sessionStorage);
      } catch {
        // Ignore storage errors in restrictive browser modes.
      }
      setSelectedFiles([]);

      // Redirect immediately to project overview — phase0 runs in the background
      window.location.href = `/projects/${primaryProjectId}`;
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
          {/* Bulk import banner */}
          <a
            href="/bulk-import"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              marginBottom: 20,
              borderRadius: 10,
              border: "1px solid rgba(59,130,246,.25)",
              background: "rgba(59,130,246,.06)",
              textDecoration: "none",
              color: "inherit",
              fontSize: 13,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18 }}>&#128230;</span>
              <div>
                <div style={{ fontWeight: 600, color: "#3B82F6" }}>Have multiple domains?</div>
                <div style={{ color: "var(--text3)", fontSize: 12 }}>
                  Use Bulk Import to scan and launch up to 50 projects at once
                </div>
              </div>
            </div>
            <span style={{ color: "#3B82F6", fontWeight: 600, fontSize: 12 }}>Bulk Import &rarr;</span>
          </a>

          <div className="wizard-title-row">
            <h2>What are you building?</h2>
            <span className="pill cyan">S0</span>
          </div>
          <p className="wizard-desc">
            Drop in a domain, paste a repo URL, or just describe your idea. We will take it from there.
          </p>

          <label className="field-label">Domain Names (optional, multiple supported)</label>
          <textarea
            className="mock-textarea"
            placeholder="offlinedad.com, offlinedad.app"
            value={form.domain}
            onChange={(event) => setForm((prev) => ({ ...prev, domain: event.target.value }))}
          />
          <p className="field-note">
            Add one or more domains separated by commas or new lines. Launch creates one project per domain.
          </p>
          {primaryDomain && (
            <p className="field-note">
              Primary domain: {primaryDomain}
              {additionalDomains.length ? ` (+${additionalDomains.length} additional)` : ""}
            </p>
          )}

          <label className="field-label">Describe Your Idea (optional if domain or repo is provided)</label>
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
                if (!ensureClarifyEntryIsValid()) return;
                setStep("clarify");
              }}
              disabled={busy}
            >
              Skip scan, go to settings →
            </button>
          </div>
          <p className="field-note">Scanning checks your domain and repo in read-only mode. No changes are made.</p>
          {form.uploaded_files.length > 0 && selectedFiles.length === 0 && (
            <p className="field-note">If you refreshed the page, reselect files so they can be uploaded securely at launch.</p>
          )}
        </section>
      )}

      {step === "discover" && (
        <section className="wizard-card">
          <div className="wizard-title-row">
            <h2>Scanning Your Assets…</h2>
            <span className="pill green">S1</span>
          </div>
          <p className="wizard-desc">We are checking what already exists. This takes 10-30 seconds.</p>

          <div className="loading-bar">
            <div className="fill" />
          </div>

          <p className="field-note" style={{ marginTop: 0, marginBottom: 12 }}>Running Pre-Phase 0 Asset Discovery</p>

          <div className="scan-list">
            {[
              { label: "DNS Lookup", sub: primaryDomain ? `${primaryDomain}` : "No domain supplied", skipIf: !primaryDomain },
              { label: "HTTP Probe", sub: primaryDomain ? "Checking status, TLS, and redirects" : "No domain supplied", skipIf: !primaryDomain },
              { label: "Meta & Content Scrape", sub: primaryDomain ? "Extracting title, description, OG tags" : "No domain supplied", skipIf: !primaryDomain },
              { label: "Repository Scan", sub: form.repo_url ? normalizeRepo(form.repo_url) : "No repository supplied", skipIf: !form.repo_url.trim() },
              { label: "Competitor Quick-Scan", sub: "Searching related domains and products", skipIf: false },
            ].map((item, index) => {
              const status = scanItemStatuses[index] ?? "queued";
              const iconClass = status === "done" ? "live" : status === "running" ? "repo" : "none";
              const icon = status === "done" ? "✓" : status === "running" ? "⟳" : status === "skipped" ? "—" : "○";
              const badgeClass = status === "done" ? "live" : status === "running" ? "found" : "none";
              const badgeText = status === "done" ? "RESOLVED" : status === "running" ? "RUNNING" : status === "skipped" ? "SKIPPED" : "QUEUED";
              const opacity = status === "queued" ? 0.5 : 1;
              return (
                <div key={item.label} className="scan-result" style={{ opacity, transition: "opacity 0.3s ease" }}>
                  <div className={`scan-icon ${iconClass}`}>{icon}</div>
                  <div className="scan-main">
                    <div className="scan-label">{item.label}</div>
                    <div className="scan-sub">{item.sub}</div>
                  </div>
                  <div className={`scan-badge ${badgeClass}`}>{badgeText}</div>
                </div>
              );
            })}
          </div>

          <div className="button-row">
            <button className="mock-btn disabled" disabled>Waiting…</button>
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
                {primaryDomain} is LIVE. Existing site context will be included in packet generation.
              </p>
            </div>
          )}
          {domainStatus === "parked" && (
            <div className="warning-state">
              <p className="warning-text">
                {primaryDomain} appears parked. We found no real product content, but the domain exists.
              </p>
            </div>
          )}
          {domainStatus === "none" && primaryDomain && (
            <div className="warning-state">
              <p className="warning-text">Domain did not resolve as a live site. You can still continue with idea-only context.</p>
            </div>
          )}

          <div className="scan-list">
            {primaryDomain && (
              <div className="scan-result">
                <div className={`scan-icon ${domainStatus === "live" ? "live" : domainStatus === "parked" ? "parked" : "none"}`}>
                  {domainStatus === "live" ? "🌐" : domainStatus === "parked" ? "P" : "○"}
                </div>
                <div className="scan-main">
                  <div className="scan-label">
                    {primaryDomain}
                    {additionalDomains.length ? ` (+${additionalDomains.length} more)` : ""}
                  </div>
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

          {form.runtime_mode === "attached" && form.repo_url.trim() && (
            <div className="github-connect-section" style={{ marginBottom: 12 }}>
              {githubConnection.connected ? (
                <div className="success-state">
                  <p className="success-text" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {githubConnection.avatar_url && (
                      <img
                        src={githubConnection.avatar_url}
                        alt=""
                        width={20}
                        height={20}
                        style={{ borderRadius: "50%" }}
                      />
                    )}
                    GitHub connected as <strong style={{ marginLeft: 4 }}>{githubConnection.username}</strong>
                  </p>
                </div>
              ) : (
                <div className="warning-state">
                  <p className="warning-text" style={{ marginBottom: 8 }}>
                    Connect your GitHub account to allow agents to read your repo and open PRs.
                  </p>
                  <button
                    type="button"
                    className="mock-btn primary"
                    style={{ fontSize: 12, padding: "8px 16px" }}
                    disabled={githubLoading || !isSignedIn}
                    onClick={() => {
                      setGithubLoading(true);
                      window.location.href = `/api/auth/github?redirect_uri=${encodeURIComponent("/onboarding")}`;
                    }}
                  >
                    {githubLoading ? "Connecting…" : "Connect GitHub"}
                  </button>
                  {!isSignedIn && (
                    <p className="field-note" style={{ marginTop: 6 }}>Sign in first to connect GitHub.</p>
                  )}
                </div>
              )}
            </div>
          )}

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
            <span className="confirm-value">{summary.projectSeed.slice(0, 75)}{summary.projectSeed.length > 75 ? "…" : ""}</span>
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
              {parsedDomains.length > 1 ? ` We will create ${parsedDomains.length} projects (one per domain).` : ""}
              {form.night_shift ? " Night shift will run automatically tonight." : " Night shift is disabled for now."}
            </div>
          </div>

          {!isSignedIn && (
            <div className="warning-state" style={{ marginTop: 12 }}>
              <p className="warning-text">Sign in is required before launching this project.</p>
              <div className="button-row" style={{ marginTop: 8 }}>
                <SignInButton mode="modal">
                  <button type="button" className="mock-btn primary">
                    Sign in
                  </button>
                </SignInButton>
              </div>
            </div>
          )}

          {launchProgress.length > 0 && (
            <div className="task-progress">
              <div className="field-label">Packet Generation Progress{busy && launchElapsed > 3 ? ` — ${formatElapsed(launchElapsed)}` : ""}</div>
              {launchProgress.map((task, index) => (
                <div key={`${task.created_at}-${index}`} className="task-item">
                  <span>{task.description}{task.detail ? ` — ${task.detail}` : ""}</span>
                  <span className={`task-status ${task.status}`}>{task.status}</span>
                </div>
              ))}
              {busy && launchElapsed > 15 && (
                <p className="progress-hint" style={{ margin: "8px 0 0", opacity: 0.6, fontSize: "0.85em" }}>
                  This usually takes 2–3 minutes. Your CEO agent is analyzing the market.
                </p>
              )}
            </div>
          )}

          <div className="button-row">
            <button className="mock-btn primary launch" onClick={launchProject} disabled={busy || !isSignedIn}>
              {busy ? `Launching…${launchElapsed > 5 ? ` (${formatElapsed(launchElapsed)})` : ""}` : "Launch Project"}
            </button>
            <button className="mock-btn secondary" onClick={() => setStep("clarify")} disabled={busy}>
              ← Edit
            </button>
          </div>
        </section>
      )}

      {step === "launched" && (
        <section className="wizard-card launched-card">
          <div className="launched-icon-wrap">
            <div className="launched-icon">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="24" fill="#22C55E" opacity="0.15" />
                <circle cx="24" cy="24" r="16" fill="#22C55E" opacity="0.25" />
                <path d="M16 24.5L21.5 30L32 18" stroke="#22C55E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
          <div className="wizard-title-row" style={{ justifyContent: "center" }}>
            <h2>Project Launched</h2>
          </div>
          <p className="wizard-desc" style={{ textAlign: "center" }}>
            Your CEO agent is now generating the Phase 0 greenlight packet.
          </p>

          {launchProgress.length > 0 && (
            <div className="task-progress" style={{ marginTop: 12 }}>
              {launchProgress.map((task, index) => (
                <div key={`${task.created_at}-${index}`} className="task-item">
                  <span>{task.description}{task.detail ? ` — ${task.detail}` : ""}</span>
                  <span className={`task-status ${task.status}`}>{task.status}</span>
                </div>
              ))}
            </div>
          )}

          <div className="launched-redirect">
            <div className="launched-spinner" />
            <span>Redirecting to your project workspace…</span>
          </div>
        </section>
      )}
    </div>
  );
}
