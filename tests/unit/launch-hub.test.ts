import { describe, expect, it } from "vitest";
import { buildLaunchHubResponse, buildLaunchPackManifest } from "@/lib/launch-hub";

type LaunchHubSource = Parameters<typeof buildLaunchHubResponse>[0];

function sourceFixture(overrides: Partial<LaunchHubSource> = {}): LaunchHubSource {
  return {
    project: {
      id: "project-123",
      name: "Acme Health",
      phase: 1,
      domain: null,
      runtime_mode: "shared",
      updated_at: "2026-03-11T12:00:00.000Z",
      live_url: "/launch/project-123",
    },
    deployment: {
      status: "ready",
      html_content: "<html><body>Launch</body></html>",
      metadata: { asset_id: "landing-selected" },
      deployed_at: "2026-03-11T12:05:00.000Z",
      updated_at: "2026-03-11T12:05:00.000Z",
    },
    assets: [
      {
        id: "landing-selected",
        phase: 1,
        kind: "landing_html",
        storage_bucket: "project-assets",
        storage_path: "project-123/deployments/landing-v3.html",
        filename: "landing-v3.html",
        mime_type: "text/html",
        metadata: { selected_variant: true, variant_index: 3, design_score: 92 },
        created_at: "2026-03-11T12:04:00.000Z",
      },
      {
        id: "landing-alt",
        phase: 1,
        kind: "landing_html",
        storage_bucket: "project-assets",
        storage_path: "project-123/deployments/landing-v2.html",
        filename: "landing-v2.html",
        mime_type: "text/html",
        metadata: { variant_index: 2, design_score: 88 },
        created_at: "2026-03-11T12:03:00.000Z",
      },
      {
        id: "brand-brief",
        phase: 1,
        kind: "upload",
        storage_bucket: "project-assets",
        storage_path: "project-123/brand/brand-brief.html",
        filename: "brand-brief.html",
        mime_type: "text/html",
        metadata: { brand_brief: true },
        created_at: "2026-03-11T12:02:00.000Z",
      },
      {
        id: "logo",
        phase: 1,
        kind: "upload",
        storage_bucket: "project-assets",
        storage_path: "project-123/brand/logo.png",
        filename: "logo.png",
        mime_type: "image/png",
        metadata: { brand_asset: true, label: "AI Logo" },
        created_at: "2026-03-11T12:01:00.000Z",
      },
      {
        id: "gtm-plan",
        phase: 2,
        kind: "upload",
        storage_bucket: "project-assets",
        storage_path: "project-123/phase-2/social-marketing-plan.md",
        filename: "social-marketing-plan.md",
        mime_type: "text/markdown",
        metadata: {},
        created_at: "2026-03-11T12:06:00.000Z",
      },
      {
        id: "phase-deck",
        phase: 1,
        kind: "packet_export",
        storage_bucket: "project-assets",
        storage_path: "project-123/phase-1/phase-1-packet.pptx",
        filename: "phase-1-packet.pptx",
        mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        metadata: {},
        created_at: "2026-03-11T12:07:00.000Z",
      },
      {
        id: "ignore-me",
        phase: 1,
        kind: "upload",
        storage_bucket: "project-assets",
        storage_path: "project-123/raw/user-notes.txt",
        filename: "user-notes.txt",
        mime_type: "text/plain",
        metadata: {},
        created_at: "2026-03-11T12:08:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("launch hub response", () => {
  it("groups only launch-relevant assets and keeps the selected landing first", () => {
    const response = buildLaunchHubResponse(sourceFixture());

    expect(response.preview.status).toBe("ready");
    expect(response.preview.url).toBe("/launch/project-123");
    expect(response.sections.landing).toHaveLength(2);
    expect(response.sections.landing[0]?.id).toBe("landing-selected");
    expect(response.sections.landing[0]?.badge).toBe("Selected");
    expect(response.sections.brand.map((asset) => asset.id)).toEqual(["brand-brief", "logo"]);
    expect(response.sections.gtm.map((asset) => asset.id)).toEqual(["gtm-plan"]);
    expect(response.sections.exports.map((asset) => asset.id)).toEqual(["phase-deck"]);
    expect(
      Object.values(response.sections)
        .flat()
        .some((asset) => asset.id === "ignore-me"),
    ).toBe(false);
  });

  it("creates a launch pack manifest with preview html and sectioned asset paths", () => {
    const manifest = buildLaunchPackManifest(sourceFixture());

    expect(manifest[0]?.entryName).toBe("preview/index.html");
    expect(manifest.some((entry) => entry.entryName === "landing/landing-v3.html")).toBe(true);
    expect(manifest.some((entry) => entry.entryName === "brand/brand-brief.html")).toBe(true);
    expect(manifest.some((entry) => entry.entryName === "gtm/social-marketing-plan.md")).toBe(true);
    expect(manifest.some((entry) => entry.entryName === "exports/phase-1-packet.pptx")).toBe(true);
  });

  it("surfaces blockers when preview and launch assets are missing", () => {
    const response = buildLaunchHubResponse(sourceFixture({ deployment: null, assets: [] }));

    expect(response.preview.status).toBe("not_ready");
    expect(response.emptyState?.blockers).toContain("No live preview has been deployed yet.");
    expect(response.emptyState?.blockers).toContain("No launch-ready assets have been generated yet.");
  });
});
