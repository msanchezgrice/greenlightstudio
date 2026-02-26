"use client";

import { useState } from "react";

type Props = {
  exportUrl: string;
  shareApiUrl: string;
};

export function PacketActions({ exportUrl, shareApiUrl }: Props) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function createAndCopyShareLink() {
    setBusy(true);
    setNotice(null);

    try {
      const response = await fetch(shareApiUrl, { method: "POST" });
      const raw = await response.text();
      const json = raw.trim() ? (JSON.parse(raw) as { shareUrl?: string; error?: string }) : {};
      if (!response.ok || !json.shareUrl) {
        throw new Error(json.error ?? `Share link request failed (HTTP ${response.status})`);
      }

      await navigator.clipboard.writeText(json.shareUrl);
      setNotice("Share link copied.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to copy share link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <a className="btn btn-ghost" href={exportUrl}>
        📄 Export PDF
      </a>
      <button className="btn btn-ghost" type="button" onClick={createAndCopyShareLink} disabled={busy}>
        🔗 {busy ? "Sharing..." : "Share"}
      </button>
      {notice && <span className="meta-line">{notice}</span>}
    </div>
  );
}

