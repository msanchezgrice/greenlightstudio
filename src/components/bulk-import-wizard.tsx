"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { BatchProgress } from "@/components/batch-progress";

/* ---------- Types ---------- */

type DomainEntry = {
  domain: string;
  enabled: boolean;
  target_demo: string;
  value_prop: string;
  how_it_works: string;
  notes: string;
  scan_status: "pending" | "live" | "parked" | "new" | "error";
};

type ScanOptions = {
  asset_discovery: boolean;
  auto_suggest: boolean;
  night_shift: boolean;
};

type ImportTab = "paste" | "csv" | "screenshot";

/* ---------- Helpers ---------- */

const domainSeparatorPattern = /[\n,;\s]+/;

function normalizeDomain(raw: string) {
  return raw
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
}

function parseDomains(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(domainSeparatorPattern)
        .map((entry) => normalizeDomain(entry))
        .filter(Boolean),
    ),
  );
}

function domainIcon(index: number): string {
  const icons = [
    "\uD83D\uDE80",
    "\uD83C\uDFE0",
    "\uD83E\uDE84",
    "\uD83C\uDFAF",
    "\uD83D\uDC8E",
    "\uD83D\uDCE6",
    "\uD83E\uDD16",
    "\uD83D\uDCA1",
    "\uD83C\uDF1F",
    "\u26A1",
  ];
  return icons[index % icons.length];
}

/* ---------- Component ---------- */

export function BulkImportWizard() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [activeTab, setActiveTab] = useState<ImportTab>("paste");
  const [rawText, setRawText] = useState("");
  const [domains, setDomains] = useState<DomainEntry[]>([]);
  const [scanOptions, setScanOptions] = useState<ScanOptions>({
    asset_discovery: true,
    auto_suggest: true,
    night_shift: false,
  });
  const [batchId, setBatchId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenshotInputRef = useRef<HTMLInputElement>(null);

  /* Parse domains from raw text */
  const detectedDomains = useMemo(() => parseDomains(rawText), [rawText]);

  /* Step 1 -> Step 2 transition: scan domains then build entries */
  const handleContinueToRefine = useCallback(async () => {
    if (detectedDomains.length === 0) {
      setError("Paste at least one domain to continue.");
      return;
    }
    setError(null);
    setScanning(true);
    setScanProgress(`Scanning ${detectedDomains.length} domain${detectedDomains.length !== 1 ? "s" : ""}...`);

    try {
      const res = await fetch("/api/bulk-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains: detectedDomains }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Scan request failed" }));
        throw new Error(body.error || `Scan failed (HTTP ${res.status})`);
      }

      const { results } = (await res.json()) as {
        results: Array<{
          domain: string;
          scan: { dns: string | null; meta?: { title?: string | null } } | null;
          suggestions: {
            target_demo: string;
            value_prop: string;
            how_it_works: string;
            notes: string;
          } | null;
          error?: string;
        }>;
      };

      const entries: DomainEntry[] = results.map((r) => {
        let scanStatus: DomainEntry["scan_status"] = "pending";
        if (r.error && !r.scan) {
          scanStatus = "error";
        } else if (r.scan?.dns === "live") {
          scanStatus = "live";
        } else if (r.scan?.dns === "parked") {
          scanStatus = "parked";
        } else if (r.scan?.dns === "none" || r.scan?.dns === null) {
          scanStatus = "new";
        }

        return {
          domain: r.domain,
          enabled: scanStatus !== "error",
          target_demo: r.suggestions?.target_demo ?? "",
          value_prop: r.suggestions?.value_prop ?? "",
          how_it_works: r.suggestions?.how_it_works ?? "",
          notes: r.suggestions?.notes ?? "",
          scan_status: scanStatus,
        };
      });

      setDomains(entries);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Domain scanning failed");
    } finally {
      setScanning(false);
      setScanProgress("");
    }
  }, [detectedDomains]);

  /* CSV file handler */
  const handleCsvUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === "string") {
        setRawText(text);
      }
    };
    reader.readAsText(file);
  }, []);

  /* Screenshot handler (placeholder) */
  const handleScreenshotUpload = useCallback((_e: React.ChangeEvent<HTMLInputElement>) => {
    setError("Screenshot OCR is coming soon. Please paste domains manually for now.");
  }, []);

  /* Toggle domain enabled/disabled */
  const toggleDomain = useCallback((index: number) => {
    setDomains((prev) => prev.map((d, i) => (i === index ? { ...d, enabled: !d.enabled } : d)));
  }, []);

  /* Update domain field */
  const updateDomainField = useCallback(
    (index: number, field: keyof DomainEntry, value: string) => {
      setDomains((prev) => prev.map((d, i) => (i === index ? { ...d, [field]: value } : d)));
    },
    [],
  );

  /* Select all / deselect all */
  const selectAll = useCallback(() => {
    setDomains((prev) => prev.map((d) => ({ ...d, enabled: true })));
  }, []);

  const deselectAll = useCallback(() => {
    setDomains((prev) => prev.map((d) => ({ ...d, enabled: false })));
  }, []);

  /* Launch batch */
  const handleLaunchBatch = useCallback(async () => {
    const enabledDomains = domains.filter((d) => d.enabled);
    if (enabledDomains.length === 0) {
      setError("Enable at least one project to launch the batch.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      // Create batch
      const createRes = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domains: domains.map((d) => ({
            domain: d.domain,
            enabled: d.enabled,
            target_demo: d.target_demo || undefined,
            value_prop: d.value_prop || undefined,
            how_it_works: d.how_it_works || undefined,
            notes: d.notes || undefined,
          })),
          scan_options: scanOptions,
        }),
      });

      const createJson = await createRes.json();
      if (!createRes.ok) {
        throw new Error(createJson.error || `Batch creation failed (HTTP ${createRes.status})`);
      }

      const newBatchId = createJson.batch?.id;
      if (!newBatchId) {
        throw new Error("Batch creation returned an invalid response.");
      }

      // Launch batch
      const launchRes = await fetch(`/api/batches/${newBatchId}/launch`, { method: "POST" });
      const launchJson = await launchRes.json();
      if (!launchRes.ok) {
        throw new Error(launchJson.error || `Batch launch failed (HTTP ${launchRes.status})`);
      }

      setBatchId(newBatchId);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch launch failed");
    } finally {
      setBusy(false);
    }
  }, [domains, scanOptions]);

  const enabledCount = domains.filter((d) => d.enabled).length;

  /* ---------- Render ---------- */

  return (
    <div className="bulk-wizard">
      {/* Stepper */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 40 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: step >= 1 ? "var(--green)" : "var(--border)",
              color: step >= 1 ? "var(--bg)" : "var(--text3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {step > 1 ? "\u2713" : "1"}
          </div>
          <span
            style={{
              fontSize: 14,
              fontWeight: step === 1 ? 600 : 400,
              color: step === 1 ? "var(--green)" : "var(--text3)",
            }}
          >
            Import
          </span>
        </div>
        <div style={{ flex: "0 0 60px", height: 2, background: "var(--border)" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: step >= 3 ? "var(--green)" : step === 2 ? "#3B82F6" : "var(--border)",
              color: step >= 2 ? "#fff" : "var(--text3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {step > 2 ? "\u2713" : "2"}
          </div>
          <span
            style={{
              fontSize: 14,
              fontWeight: step === 2 ? 600 : 400,
              color: step === 2 ? "var(--heading)" : "var(--text3)",
            }}
          >
            Refine
          </span>
        </div>
        <div style={{ flex: "0 0 60px", height: 2, background: "var(--border)" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: step === 3 ? "#3B82F6" : "var(--border)",
              color: step === 3 ? "#fff" : "var(--text3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            3
          </div>
          <span style={{ fontSize: 14, color: step === 3 ? "var(--heading)" : "var(--text3)" }}>
            Batch Progress
          </span>
        </div>
      </div>

      {error && <div className="wizard-error">{error}</div>}

      {/* ======================== SCANNING OVERLAY ======================== */}
      {scanning && (
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "40px 32px",
            textAlign: "center",
            marginBottom: 24,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              border: "3px solid var(--border)",
              borderTopColor: "var(--green)",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
              margin: "0 auto 16px",
            }}
          />
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
            Scanning {detectedDomains.length} domain{detectedDomains.length !== 1 ? "s" : ""}...
          </h2>
          <p style={{ color: "var(--text3)", fontSize: 13, marginBottom: 20 }}>
            {scanProgress || "Checking DNS, fetching pages, and generating suggestions with AI"}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 360, margin: "0 auto" }}>
            {detectedDomains.map((d) => (
              <div
                key={d}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  color: "var(--text2)",
                  padding: "4px 8px",
                  background: "var(--bg)",
                  borderRadius: 6,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--green)",
                    animation: "pulse 1.5s ease-in-out infinite",
                    flexShrink: 0,
                  }}
                />
                {d}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ======================== STEP 1: IMPORT ======================== */}
      {step === 1 && !scanning && (
        <>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Bulk Import Projects</h1>
          <p style={{ color: "var(--text2)", fontSize: 15, marginBottom: 36 }}>
            Paste a list of domains, upload a CSV, or drop a screenshot &mdash; we&apos;ll scan each one and prepare
            Phase 0 packets in batch.
          </p>

          {/* Method tabs */}
          <div className="bulk-tabs">
            <button
              type="button"
              className={`bulk-tab ${activeTab === "paste" ? "active" : ""}`}
              onClick={() => setActiveTab("paste")}
            >
              Paste Domains
            </button>
            <button
              type="button"
              className={`bulk-tab ${activeTab === "csv" ? "active" : ""}`}
              onClick={() => setActiveTab("csv")}
            >
              Upload CSV
            </button>
            <button
              type="button"
              className={`bulk-tab ${activeTab === "screenshot" ? "active" : ""}`}
              onClick={() => setActiveTab("screenshot")}
            >
              Screenshot / Image
            </button>
          </div>

          {/* Paste area */}
          {activeTab === "paste" && (
            <div className="bulk-domains-area">
              <label className="field-label">Paste domains &mdash; one per line</label>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder={
                  "offlinedad.com\nwarmstart.it\nconjureanything.com\nlaunchready.me"
                }
              />
              <div className="bulk-domain-count">
                <span>
                  {detectedDomains.length} domain{detectedDomains.length !== 1 ? "s" : ""} detected
                </span>
                <span>Tip: works with URLs too &mdash; we&apos;ll extract the root domain</span>
              </div>
            </div>
          )}

          {/* CSV upload */}
          {activeTab === "csv" && (
            <div className="bulk-domains-area">
              <label className="field-label">Upload a CSV file with domains</label>
              <div
                className="upload-box"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  minHeight: 200,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <input ref={fileInputRef} type="file" accept=".csv,.txt" onChange={handleCsvUpload} />
                <span>Drop CSV file here or click to browse</span>
                <span className="upload-note">CSV with one domain per row, or comma-separated</span>
              </div>
              {rawText && (
                <div className="bulk-domain-count">
                  <span>
                    {detectedDomains.length} domain{detectedDomains.length !== 1 ? "s" : ""} detected from file
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Screenshot upload */}
          {activeTab === "screenshot" && (
            <div className="bulk-domains-area">
              <label className="field-label">Upload a screenshot containing domains</label>
              <div
                className="upload-box"
                onClick={() => screenshotInputRef.current?.click()}
                style={{
                  minHeight: 200,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <input
                  ref={screenshotInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp"
                  onChange={handleScreenshotUpload}
                />
                <span>Drop screenshot here or click to browse</span>
                <span className="upload-note">
                  PNG, JPG, WebP &mdash; we&apos;ll OCR domains from the image
                </span>
              </div>
            </div>
          )}

          {/* Scan options */}
          <div className="bulk-scan-options">
            <div className="field-label">Scan options</div>
            <button
              type="button"
              className="bulk-scan-toggle"
              onClick={() =>
                setScanOptions((prev) => ({ ...prev, asset_discovery: !prev.asset_discovery }))
              }
            >
              <span className={`toggle-track ${scanOptions.asset_discovery ? "on" : ""}`}>
                <span className="toggle-dot" />
              </span>
              <div>
                <div className="bulk-scan-toggle-label">Pre-Phase 0 Asset Discovery</div>
                <div className="bulk-scan-toggle-desc">
                  Read-only scan of landing page, social presence, GitHub repos
                </div>
              </div>
            </button>
            <button
              type="button"
              className="bulk-scan-toggle"
              onClick={() =>
                setScanOptions((prev) => ({ ...prev, auto_suggest: !prev.auto_suggest }))
              }
            >
              <span className={`toggle-track ${scanOptions.auto_suggest ? "on" : ""}`}>
                <span className="toggle-dot" />
              </span>
              <div>
                <div className="bulk-scan-toggle-label">Auto-suggest Target Demo &amp; Value Prop</div>
                <div className="bulk-scan-toggle-desc">
                  AI will pre-fill columns on the Refine screen based on scan results
                </div>
              </div>
            </button>
            <button
              type="button"
              className="bulk-scan-toggle"
              onClick={() =>
                setScanOptions((prev) => ({ ...prev, night_shift: !prev.night_shift }))
              }
            >
              <span className={`toggle-track ${scanOptions.night_shift ? "on" : ""}`}>
                <span className="toggle-dot" />
              </span>
              <div>
                <div className="bulk-scan-toggle-label">Run as Night Shift batch</div>
                <div className="bulk-scan-toggle-desc">
                  Queue all Phase 0 jobs for overnight processing
                </div>
              </div>
            </button>
          </div>

          {/* Action bar */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <button
              type="button"
              className="mock-btn secondary"
              onClick={() => {
                setRawText("");
                setError(null);
              }}
            >
              Cancel
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <span style={{ fontSize: 13, color: "var(--text3)" }}>
                {detectedDomains.length} domain{detectedDomains.length !== 1 ? "s" : ""} will be
                scanned
              </span>
              <button
                type="button"
                className="mock-btn primary"
                disabled={detectedDomains.length === 0 || scanning}
                onClick={handleContinueToRefine}
              >
                {scanning ? "Scanning..." : "Scan & Continue to Refine \u2192"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ======================== STEP 2: REFINE ======================== */}
      {step === 2 && (
        <>
          <div
            style={{
              display: "inline-flex",
              padding: "4px 12px",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              background: "rgba(59,130,246,.12)",
              color: "#3B82F6",
              marginBottom: 12,
            }}
          >
            STEP 2 OF 3 &middot; REFINE
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Refine Before Kick-Off</h1>
          <p style={{ color: "var(--text3)", fontSize: 13, marginBottom: 24, lineHeight: 1.5 }}>
            We scanned your {domains.length} domains. Review the suggested target demo, value props,
            and notes below. Edit anything, toggle off projects you want to skip, then hit &ldquo;Kick
            off Batch.&rdquo;
          </p>

          {/* Info bar */}
          <div
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "16px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 20,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13 }}>
              <b style={{ color: "var(--green)" }}>{enabledCount}</b> of {domains.length} projects
              enabled
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="mock-btn secondary"
                style={{ fontSize: 12, padding: "5px 12px" }}
                onClick={selectAll}
              >
                Select All
              </button>
              <button
                type="button"
                className="mock-btn secondary"
                style={{ fontSize: 12, padding: "5px 12px" }}
                onClick={deselectAll}
              >
                Deselect All
              </button>
            </div>
          </div>

          {/* Refine table */}
          <table className="refine-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>ON</th>
                <th style={{ width: "15%" }}>Project</th>
                <th style={{ width: "7%" }}>Scan</th>
                <th style={{ width: "18%" }}>Target Demo</th>
                <th style={{ width: "20%" }}>Value Prop</th>
                <th style={{ width: "16%" }}>How It Works</th>
                <th style={{ width: "16%" }}>Other Notes</th>
              </tr>
            </thead>
            <tbody>
              {domains.map((d, i) => {
                const isDisabled = d.scan_status === "error";
                const scanBadgeClass =
                  d.scan_status === "live"
                    ? "live"
                    : d.scan_status === "parked"
                      ? "parked"
                      : d.scan_status === "error"
                        ? "err"
                        : "new";
                const scanBadgeLabel =
                  d.scan_status === "live"
                    ? "\u25CF Live"
                    : d.scan_status === "parked"
                      ? "\u25D0 Parked"
                      : d.scan_status === "error"
                        ? "\u2715 Error"
                        : "\u25C7 New";

                return (
                  <tr
                    key={d.domain}
                    className={isDisabled && !d.enabled ? "refine-disabled-row" : undefined}
                  >
                    <td>
                      <div
                        className={`refine-toggle ${d.enabled ? "on" : ""}`}
                        onClick={() => toggleDomain(i)}
                      >
                        <div className="dot" />
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 6,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 13,
                            background: "linear-gradient(135deg, #22C55E10, #22C55E20)",
                            flexShrink: 0,
                          }}
                        >
                          {domainIcon(i)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 12, color: "var(--heading)" }}>
                            {d.domain}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--text3)" }}>
                            {d.scan_status === "pending"
                              ? "New"
                              : d.scan_status === "error"
                                ? "\u2014"
                                : "Existing project"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`refine-scan-badge ${scanBadgeClass}`}>
                        {scanBadgeLabel}
                      </span>
                    </td>
                    <td>
                      <textarea
                        className="refine-input"
                        rows={2}
                        disabled={isDisabled && !d.enabled}
                        value={d.target_demo}
                        onChange={(e) => updateDomainField(i, "target_demo", e.target.value)}
                        placeholder="Target audience..."
                      />
                    </td>
                    <td>
                      <textarea
                        className="refine-input"
                        rows={2}
                        disabled={isDisabled && !d.enabled}
                        value={d.value_prop}
                        onChange={(e) => updateDomainField(i, "value_prop", e.target.value)}
                        placeholder="Value proposition..."
                      />
                    </td>
                    <td>
                      <textarea
                        className="refine-input"
                        rows={2}
                        disabled={isDisabled && !d.enabled}
                        value={d.how_it_works}
                        onChange={(e) => updateDomainField(i, "how_it_works", e.target.value)}
                        placeholder="How it works..."
                      />
                    </td>
                    <td>
                      <textarea
                        className="refine-input"
                        rows={2}
                        disabled={isDisabled && !d.enabled}
                        value={d.notes}
                        onChange={(e) => updateDomainField(i, "notes", e.target.value)}
                        placeholder="Notes..."
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Sticky bottom bar */}
          <div className="refine-sticky-bar">
            <div className="refine-sticky-bar-left">
              <b>
                {enabledCount} project{enabledCount !== 1 ? "s" : ""}
              </b>{" "}
              will enter Phase 0
              {scanOptions.night_shift ? " \u00B7 Estimated: ~5 hours (Night Shift)" : ""}
            </div>
            <div className="refine-sticky-bar-right">
              <button
                type="button"
                className="mock-btn secondary"
                onClick={() => setStep(1)}
                disabled={busy}
              >
                &larr; Back to Import
              </button>
              <button
                type="button"
                className="mock-btn primary"
                onClick={handleLaunchBatch}
                disabled={busy || enabledCount === 0}
              >
                {busy ? "Launching..." : "Kick off Batch \u2192"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ======================== STEP 3: PROGRESS ======================== */}
      {step === 3 && batchId && <BatchProgress batchId={batchId} />}
    </div>
  );
}
