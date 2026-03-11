import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { createStoredZip } from "@/lib/zip";
import type { LaunchHubAsset, LaunchHubResponse, LaunchHubSectionId } from "@/types/launch-hub";

type OwnedProjectRow = {
  id: string;
  name: string;
  phase: number;
  domain: string | null;
  runtime_mode: "shared" | "attached";
  updated_at: string;
  live_url: string | null;
};

type DeploymentRow = {
  status: string;
  html_content: string;
  metadata: Record<string, unknown> | null;
  deployed_at: string | null;
  updated_at?: string | null;
};

type AssetRow = {
  id: string;
  phase: number | null;
  kind: string;
  storage_bucket: string;
  storage_path: string;
  filename: string;
  mime_type: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type LaunchHubSource = {
  project: OwnedProjectRow;
  deployment: DeploymentRow | null;
  assets: AssetRow[];
};

type LaunchPackManifestItem = {
  entryName: string;
  filename: string;
  section: LaunchHubSectionId | "preview";
  assetId: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  inlineContent: Uint8Array | null;
};

const BRAND_FILENAMES = new Set([
  "brand-brief.html",
  "brand-brief.pptx",
  "logo.png",
  "hero.png",
  "social-square.png",
  "social-story.png",
  "social-landscape.png",
  "website-feature.png",
  "website-product.png",
]);

function isOwnedPreviewUrl(value: string | null, projectId: string) {
  return value ? value.includes(`/launch/${projectId}`) : false;
}

function assetMetadata(row: AssetRow) {
  return row.metadata ?? {};
}

function normalizeFilename(filename: string) {
  return filename.trim().toLowerCase();
}

function isBrandAsset(row: AssetRow) {
  const metadata = assetMetadata(row);
  const filename = normalizeFilename(row.filename);
  return (
    metadata.brand_asset === true ||
    metadata.phase0_brand_foundation === true ||
    metadata.phase0_brand_asset === true ||
    metadata.brand_brief === true ||
    metadata.brand_brief_pptx === true ||
    BRAND_FILENAMES.has(filename)
  );
}

function classifyLaunchAsset(row: AssetRow): LaunchHubSectionId | null {
  const metadata = assetMetadata(row);
  const filename = normalizeFilename(row.filename);

  if (row.kind === "landing_html" || metadata.landing_variant === true || filename.endsWith(".html") && filename.startsWith("landing")) {
    return "landing";
  }

  if (isBrandAsset(row)) {
    return "brand";
  }

  if (
    metadata.phase2_marketing_assets === true ||
    metadata.phase2_marketing_plan === true ||
    filename === "social-marketing-plan.md"
  ) {
    return "gtm";
  }

  if (
    row.kind === "packet_export" ||
    metadata.phase_packet_embed === true ||
    metadata.phase_packet_pptx === true ||
    /^phase-\d+-packet\.(html|pptx|pdf)$/i.test(row.filename)
  ) {
    return "exports";
  }

  return null;
}

function assetBadge(row: AssetRow, section: LaunchHubSectionId) {
  const metadata = assetMetadata(row);
  if (section === "landing") {
    if (metadata.selected_variant === true) return "Selected";
    if (typeof metadata.variant_index === "number") return `Variant ${metadata.variant_index}`;
  }
  if (section === "brand") {
    if (metadata.brand_brief === true) return "HTML";
    if (metadata.brand_brief_pptx === true) return "PPTX";
  }
  if (section === "exports" && typeof row.phase === "number") {
    return `Phase ${row.phase}`;
  }
  return null;
}

function assetLabel(row: AssetRow, section: LaunchHubSectionId) {
  const metadata = assetMetadata(row);
  if (typeof metadata.label === "string" && metadata.label.trim().length > 0) {
    return metadata.label.trim();
  }
  if (section === "landing" && typeof metadata.variant_index === "number") {
    return metadata.selected_variant === true
      ? `Landing Variant ${metadata.variant_index} (Selected)`
      : `Landing Variant ${metadata.variant_index}`;
  }
  return row.filename;
}

function assetPriority(row: AssetRow, section: LaunchHubSectionId) {
  const metadata = assetMetadata(row);
  const filename = normalizeFilename(row.filename);
  if (section === "landing") {
    if (metadata.selected_variant === true) return 0;
    if (typeof metadata.variant_index === "number") return 10 + metadata.variant_index;
    return 99;
  }
  if (section === "brand") {
    if (metadata.brand_brief === true || filename === "brand-brief.html") return 0;
    if (metadata.brand_brief_pptx === true || filename === "brand-brief.pptx") return 1;
    return 10;
  }
  if (section === "gtm") {
    if (metadata.phase2_marketing_plan === true || filename === "social-marketing-plan.md") return 0;
    return 10;
  }
  if (section === "exports") {
    if (/\.html$/i.test(row.filename)) return 0;
    if (/\.pptx$/i.test(row.filename)) return 1;
    return 10;
  }
  return 50;
}

function compareAssets(left: AssetRow, right: AssetRow, section: LaunchHubSectionId) {
  const priorityDiff = assetPriority(left, section) - assetPriority(right, section);
  if (priorityDiff !== 0) return priorityDiff;

  const createdDiff = new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
  if (createdDiff !== 0) return createdDiff;

  return left.filename.localeCompare(right.filename);
}

function groupAssets(projectId: string, assets: AssetRow[]) {
  const grouped: Record<LaunchHubSectionId, LaunchHubAsset[]> = {
    landing: [],
    brand: [],
    gtm: [],
    exports: [],
  };

  const rowsBySection = new Map<LaunchHubSectionId, AssetRow[]>();
  for (const row of assets) {
    const section = classifyLaunchAsset(row);
    if (!section) continue;
    const bucket = rowsBySection.get(section) ?? [];
    bucket.push(row);
    rowsBySection.set(section, bucket);
  }

  for (const section of Object.keys(grouped) as LaunchHubSectionId[]) {
    const rows = (rowsBySection.get(section) ?? []).sort((left, right) => compareAssets(left, right, section));
    grouped[section] = rows.map((row) => {
      const metadata = assetMetadata(row);
      return {
        id: row.id,
        section,
        filename: row.filename,
        label: assetLabel(row, section),
        mimeType: row.mime_type,
        phase: row.phase,
        createdAt: row.created_at,
        previewUrl: `/api/projects/${projectId}/assets/${row.id}/preview`,
        downloadUrl: `/api/projects/${projectId}/assets/${row.id}/download`,
        badge: assetBadge(row, section),
        isPrimary:
          section === "landing"
            ? metadata.selected_variant === true
            : section === "brand"
              ? metadata.brand_brief === true || normalizeFilename(row.filename) === "brand-brief.html"
              : section === "gtm"
                ? metadata.phase2_marketing_plan === true || normalizeFilename(row.filename) === "social-marketing-plan.md"
                : false,
      };
    });
  }

  return grouped;
}

function previewState(source: LaunchHubSource, sections: Record<LaunchHubSectionId, LaunchHubAsset[]>) {
  const liveUrl = source.project.live_url && !source.project.live_url.includes("localhost")
    ? source.project.live_url
    : null;
  const previewUrl = source.deployment?.status === "ready" ? `/launch/${source.project.id}` : null;
  const selectedLanding = sections.landing.find((asset) => asset.isPrimary) ?? sections.landing[0] ?? null;

  return {
    url: previewUrl,
    liveUrl: isOwnedPreviewUrl(liveUrl, source.project.id) ? liveUrl : previewUrl,
    status: previewUrl ? "ready" : "not_ready",
    selectedLandingAssetId: selectedLanding?.id ?? null,
    selectedVariantLabel: selectedLanding?.label ?? null,
    updatedAt: source.deployment?.updated_at ?? source.deployment?.deployed_at ?? null,
  } as LaunchHubResponse["preview"];
}

export function buildLaunchPackManifest(source: LaunchHubSource) {
  const sections = groupAssets(source.project.id, source.assets);
  const manifest: LaunchPackManifestItem[] = [];

  if (source.deployment?.status === "ready") {
    manifest.push({
      entryName: "preview/index.html",
      filename: "index.html",
      section: "preview",
      assetId: null,
      storageBucket: null,
      storagePath: null,
      inlineContent: new TextEncoder().encode(source.deployment.html_content),
    });
  }

  for (const section of Object.keys(sections) as LaunchHubSectionId[]) {
    for (const asset of sections[section]) {
      const row = source.assets.find((candidate) => candidate.id === asset.id);
      if (!row) continue;
      manifest.push({
        entryName: `${section}/${row.filename}`,
        filename: row.filename,
        section,
        assetId: row.id,
        storageBucket: row.storage_bucket,
        storagePath: row.storage_path,
        inlineContent: null,
      });
    }
  }

  return manifest;
}

export function buildLaunchHubResponse(source: LaunchHubSource): LaunchHubResponse {
  const sections = groupAssets(source.project.id, source.assets);
  const preview = previewState(source, sections);
  const manifest = buildLaunchPackManifest(source);
  const launchAssetCount = Object.values(sections).reduce((sum, items) => sum + items.length, 0);

  const blockers: string[] = [];
  if (preview.status !== "ready") blockers.push("No live preview has been deployed yet.");
  if (launchAssetCount === 0) blockers.push("No launch-ready assets have been generated yet.");

  return {
    project: {
      id: source.project.id,
      name: source.project.name,
      phase: source.project.phase,
      domain: source.project.domain,
      runtimeMode: source.project.runtime_mode,
      updatedAt: source.project.updated_at,
    },
    preview,
    sections,
    bundle: {
      count: manifest.length,
      downloadUrl: `/api/projects/${source.project.id}/launch-pack`,
    },
    emptyState: blockers.length > 0
      ? {
          title: "Launch assets are still coming together",
          description: "The Launch Hub will fill itself in as landing, brand, and export assets are generated.",
          blockers,
        }
      : null,
  };
}

export async function loadLaunchHubSource(userId: string, projectId: string) {
  const db = createServiceSupabase();
  const [projectQuery, deploymentQuery, assetsQuery] = await Promise.all([
    withRetry(() =>
      db
        .from("projects")
        .select("id,name,phase,domain,runtime_mode,updated_at,live_url")
        .eq("id", projectId)
        .eq("owner_clerk_id", userId)
        .maybeSingle(),
    ),
    withRetry(() =>
      db
        .from("project_deployments")
        .select("status,html_content,metadata,deployed_at,updated_at")
        .eq("project_id", projectId)
        .maybeSingle(),
    ),
    withRetry(() =>
      db
        .from("project_assets")
        .select("id,phase,kind,storage_bucket,storage_path,filename,mime_type,metadata,created_at")
        .eq("project_id", projectId)
        .eq("status", "uploaded")
        .order("created_at", { ascending: false })
        .limit(300),
    ),
  ]);

  if (projectQuery.error) throw new Error(projectQuery.error.message);
  if (!projectQuery.data) return null;
  if (deploymentQuery.error) throw new Error(deploymentQuery.error.message);
  if (assetsQuery.error) throw new Error(assetsQuery.error.message);

  return {
    project: projectQuery.data as OwnedProjectRow,
    deployment: (deploymentQuery.data as DeploymentRow | null) ?? null,
    assets: (assetsQuery.data ?? []) as AssetRow[],
  } satisfies LaunchHubSource;
}

export async function getLaunchHubResponse(userId: string, projectId: string) {
  const source = await loadLaunchHubSource(userId, projectId);
  if (!source) return null;
  return buildLaunchHubResponse(source);
}

export async function buildLaunchPackZip(userId: string, projectId: string) {
  const source = await loadLaunchHubSource(userId, projectId);
  if (!source) return null;

  const db = createServiceSupabase();
  const entries = [];
  for (const item of buildLaunchPackManifest(source)) {
    if (item.inlineContent) {
      entries.push({ name: item.entryName, data: item.inlineContent });
      continue;
    }
    if (!item.storageBucket || !item.storagePath) continue;

    const { data: file, error } = await withRetry(() =>
      db.storage.from(item.storageBucket as string).download(item.storagePath as string),
    );
    if (error || !file) continue;

    entries.push({
      name: item.entryName,
      data: new Uint8Array(await file.arrayBuffer()),
    });
  }

  const safeProjectName = source.project.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";

  return {
    filename: `${safeProjectName}-launch-pack.zip`,
    buffer: createStoredZip(entries),
  };
}
