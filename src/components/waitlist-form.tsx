"use client";

import { FormEvent, useState } from "react";

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function WaitlistForm() {
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

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, source: "landing_page" }),
      });

      const text = await res.text();
      const json = text.trim() ? (JSON.parse(text) as { error?: string }) : {};
      if (!res.ok) {
        throw new Error(json.error ?? `Waitlist submit failed (HTTP ${res.status})`);
      }

      setSubmitted(true);
      setEmail("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Waitlist submit failed.");
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
        placeholder="you@company.com"
        autoComplete="email"
        required
      />
      <button className="waitlist-btn" type="submit" disabled={busy}>
        {busy ? "Submitting..." : "Join Waitlist"}
      </button>
      {submitted && <p className="waitlist-success">You are on the list.</p>}
      {error && <p className="waitlist-error">{error}</p>}
    </form>
  );
}

