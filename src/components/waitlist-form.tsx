"use client";

import { FormEvent, useState } from "react";
import { track } from "@vercel/analytics";

type WaitlistFormProps = {
  buttonLabel?: string;
  busyLabel?: string;
  successMessage?: string;
  placeholder?: string;
  source?: string;
  projectId?: string | null;
  metadata?: Record<string, unknown> | null;
  onSubmitted?: (email: string) => void;
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function parseResponseJson(response: Response) {
  const raw = await response.text();
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as { error?: string };
  } catch {
    return null;
  }
}

export function WaitlistForm({
  buttonLabel = "Join Waitlist",
  busyLabel = "Submitting...",
  successMessage = "You are on the list.",
  placeholder = "you@company.com",
  source = "landing_page",
  projectId = null,
  metadata = null,
  onSubmitted,
}: WaitlistFormProps) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }

    setBusy(true);
    setError(null);
    track("lead_capture_submitted", { source, has_project_id: Boolean(projectId) });

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          source,
          project_id: projectId,
          metadata,
        }),
      });

      const json = await parseResponseJson(res);
      if (!res.ok) {
        throw new Error(json?.error ?? `Waitlist submit failed (HTTP ${res.status})`);
      }

      setSubmitted(true);
      setEmail("");
      track("lead_capture_succeeded", { source, has_project_id: Boolean(projectId) });
      onSubmitted?.(trimmed);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Waitlist submit failed.");
      track("lead_capture_failed", { source, has_project_id: Boolean(projectId) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="waitlist-form" onSubmit={onSubmit}>
      <input
        className="waitlist-input"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder={placeholder}
        autoComplete="email"
        required
      />
      <button className="waitlist-btn" type="submit" disabled={busy}>
        {busy ? busyLabel : buttonLabel}
      </button>
      {submitted && <p className="waitlist-success">{successMessage}</p>}
      {error && <p className="waitlist-error">{error}</p>}
    </form>
  );
}
