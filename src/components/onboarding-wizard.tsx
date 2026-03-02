"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { onboardingSchema, scanResultSchema, type ScanResult } from "@/types/domain";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { humanizeTaskDescription } from "@/lib/phases";

type Step = "import" | "discover" | "results" | "error" | "confirm" | "launched";

type ScanItemStatus = "queued" | "running" | "done" | "skipped";

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
  step?: Step | "clarify";
  projectId?: string | null;
  projectIds?: string[];
  cacheHit?: boolean | null;
  form?: Partial<typeof defaultForm>;
};

const stepOrder: Step[] = ["import", "discover", "results", "confirm", "launched"];
const allowedFileExts = [".pdf", ".ppt", ".pptx", ".doc", ".docx", ".png", ".jpg", ".jpeg"];
const maxFileSizeBytes = 10 * 1024 * 1024;
const wizardStorageKey = "greenlight_onboarding_wizard_v1";
const wizardSessionStorageKey = `${wizardStorageKey}_session`;
const domainSeparatorPattern = /[\n,;]+/;

const defaultForm = {
  domain: "",
  idea_description: "",
  app_description: "",
  value_prop: "",
  mission: "",
  target_demo: "",
  demo_url: "",
  repo_url: "",
  uploaded_files: [] as UploadMeta[],
  runtime_mode: "shared" as "shared" | "attached",
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
  const resetRequested = searchParams.get("new") === "1";

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

      const restoredStep = stored.step === "clarify" ? "results" : stored.step;
      if (restoredStep && stepOrder.includes(restoredStep)) {
        setStep(restoredStep);
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
    const appDescription = form.app_description.trim();
    const valueProp = form.value_prop.trim();
    const mission = form.mission.trim();
    const targetDemo = form.target_demo.trim();
    const demoUrl = form.demo_url.trim();
    const repoDisplay = repo?.repo ?? (normalizeRepo(form.repo_url) || "None");
    const contextSeed = appDescription || ideaText || valueProp || mission || targetDemo;
    const projectSeed = contextSeed
      ? contextSeed
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
      appDescription,
      valueProp,
      mission,
      targetDemo,
      demoUrl,
    };
  }, [
    additionalDomains.length,
    form.app_description,
    form.demo_url,
    form.idea_description,
    form.mission,
    form.repo_url,
    form.scan_results,
    form.target_demo,
    form.value_prop,
    primaryDomain,
  ]);

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

    if (form.demo_url.trim()) {
      try {
        const demo = new URL(form.demo_url.trim());
        if (!["http:", "https:"].includes(demo.protocol)) {
          setError("Demo URL must use http or https.");
          return false;
        }
      } catch {
        setError("Demo URL must be a valid URL.");
        return false;
      }
    }

    return true;
  }

  function ensureProjectSeedIsValid() {
    const hasDomain = parsedDomains.length > 0;
    const hasRepo = Boolean(form.repo_url.trim());
    const hasIdea = form.idea_description.trim().length >= 20;
    const hasContext =
      form.app_description.trim().length >= 20 ||
      form.value_prop.trim().length >= 20 ||
      form.mission.trim().length >= 20 ||
      form.target_demo.trim().length >= 20;
    if (!hasDomain && !hasRepo && !hasIdea && !hasContext) {
      setError("Provide at least one domain, repository URL, or strong context (description/value prop/mission/target demo).");
      return false;
    }
    return true;
  }

  function ensureStrategicContextIsValid() {
    const requiredFields: Array<{ key: keyof FormState; label: string; min: number }> = [
      { key: "app_description", label: "App Description", min: 20 },
      { key: "value_prop", label: "Value Proposition", min: 20 },
      { key: "mission", label: "Mission", min: 20 },
      { key: "target_demo", label: "Target Demo", min: 20 },
    ];

    const missing = requiredFields.filter(({ key, min }) => {
      const value = String(form[key] ?? "").trim();
      return value.length < min;
    });

    if (missing.length > 0) {
      setError(`Please complete strategic context before launch: ${missing.map((item) => item.label).join(", ")}.`);
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

  function ensureLaunchIsValid() {
    if (!ensureDomainRepoShapeIsValid()) {
      return false;
    }

    if (!ensureProjectSeedIsValid()) {
      return false;
    }

    if (!ensureStrategicContextIsValid()) {
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
      setStep("results");
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
      setForm((prev) => {
        const inferredDescription = parsed.meta?.desc?.trim() ?? "";
        return {
          ...prev,
          scan_results: parsed,
          app_description: prev.app_description.trim() ? prev.app_description : inferredDescription,
          idea_description: prev.idea_description.trim() ? prev.idea_description : inferredDescription,
        };
      });

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
      app_description: form.app_description.trim(),
      value_prop: form.value_prop.trim(),
      mission: form.mission.trim(),
      target_demo: form.target_demo.trim(),
      demo_url: form.demo_url.trim() ? form.demo_url.trim() : null,
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

      window.location.href = "/board";
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
                if (!ensureDomainRepoShapeIsValid()) return;
                setStep("results");
              }}
              disabled={busy}
            >
              Skip scan, add strategic context →
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
                setStep("results");
              }}
            >
              Skip to context →
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
                  <div className="scan-sub" style={{ marginBottom: 4 }}>
                    {scan?.meta?.title || "No title found"}
                    {scan?.http_status ? ` · HTTP ${scan.http_status}` : ""}
                  </div>
                  {scan?.meta?.desc && (
                    <div className="scan-sub" style={{ color: "var(--text2)", lineHeight: 1.5 }}>
                      {scan.meta.desc}
                    </div>
                  )}
                  {scan?.meta?.og_image && (
                    <div className="scan-sub">
                      <a href={scan.meta.og_image} target="_blank" rel="noreferrer" className="confirm-value blue">
                        Open social image ↗
                      </a>
                    </div>
                  )}
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
                {!competitors.length ? (
                  <div className="scan-sub">No competitors discovered</div>
                ) : (
                  <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                    {competitors.slice(0, 8).map((entry, index) => (
                      <div
                        key={`${entry.name}-${index}`}
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          padding: "10px 12px",
                          background: "var(--card2)",
                        }}
                      >
                        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--heading)", marginBottom: 4 }}>
                          {entry.url ? (
                            <a href={entry.url} target="_blank" rel="noreferrer" className="confirm-value blue">
                              {entry.name} ↗
                            </a>
                          ) : (
                            entry.name
                          )}
                        </div>
                        <div className="scan-sub" style={{ color: "var(--text2)", lineHeight: 1.5 }}>
                          {entry.snippet || "No description captured from discovery scan."}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="scan-badge parked">{competitors.length}</div>
            </div>
          </div>

          <div style={{ marginTop: 16, padding: "14px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--card)" }}>
            <div className="wizard-title-row" style={{ marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Refine Strategic Context</h3>
              <span className="pill cyan">S1.6</span>
            </div>
            <p className="field-note" style={{ marginTop: 0, marginBottom: 10 }}>
              This context is required and is fed into packet and landing-page generation. Fill all fields for focused outputs.
            </p>

            <label className="field-label">App Description</label>
            <textarea
              className="mock-textarea"
              placeholder="What the product does in 1-3 sentences."
              value={form.app_description}
              onChange={(event) => setForm((prev) => ({ ...prev, app_description: event.target.value }))}
            />

            <label className="field-label">Value Proposition</label>
            <textarea
              className="mock-textarea"
              placeholder="Why this product is uniquely valuable."
              value={form.value_prop}
              onChange={(event) => setForm((prev) => ({ ...prev, value_prop: event.target.value }))}
            />

            <label className="field-label">Mission</label>
            <textarea
              className="mock-textarea"
              placeholder="Mission statement and long-term direction."
              value={form.mission}
              onChange={(event) => setForm((prev) => ({ ...prev, mission: event.target.value }))}
            />

            <label className="field-label">Target Demo</label>
            <textarea
              className="mock-textarea"
              placeholder="Who this product is for."
              value={form.target_demo}
              onChange={(event) => setForm((prev) => ({ ...prev, target_demo: event.target.value }))}
            />

            <label className="field-label">Demo URL (optional)</label>
            <input
              className="mock-input"
              placeholder="https://..."
              value={form.demo_url}
              onChange={(event) => setForm((prev) => ({ ...prev, demo_url: event.target.value }))}
            />
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
            <button
              className="mock-btn primary"
              onClick={() => {
                if (!ensureStrategicContextIsValid()) return;
                setStep("confirm");
              }}
            >
              Continue to review →
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
            <button className="mock-btn primary" onClick={() => setStep("results")}>
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
          <button type="button" className="confirm-row interactive" onClick={() => setStep("results")}>
            <span className="confirm-label">App Description</span>
            <span className="confirm-value">{summary.appDescription || "Not provided"}</span>
          </button>
          <button type="button" className="confirm-row interactive" onClick={() => setStep("results")}>
            <span className="confirm-label">Value Proposition</span>
            <span className="confirm-value">{summary.valueProp || "Not provided"}</span>
          </button>
          <button type="button" className="confirm-row interactive" onClick={() => setStep("results")}>
            <span className="confirm-label">Mission</span>
            <span className="confirm-value">{summary.mission || "Not provided"}</span>
          </button>
          <button type="button" className="confirm-row interactive" onClick={() => setStep("results")}>
            <span className="confirm-label">Target Demo</span>
            <span className="confirm-value">{summary.targetDemo || "Not provided"}</span>
          </button>
          <button type="button" className="confirm-row interactive" onClick={() => setStep("results")}>
            <span className="confirm-label">Demo URL</span>
            <span className="confirm-value blue">{summary.demoUrl || "Not provided"}</span>
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
              {" Night shift runs autonomously by default and sends daily updates."}
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
                  <span>{humanizeTaskDescription(task.description)}{task.detail ? ` — ${task.detail}` : ""}</span>
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
            <button className="mock-btn secondary" onClick={() => setStep("results")} disabled={busy}>
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
                  <span>{humanizeTaskDescription(task.description)}{task.detail ? ` — ${task.detail}` : ""}</span>
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
