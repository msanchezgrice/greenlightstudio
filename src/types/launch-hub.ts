export type LaunchHubSectionId = "landing" | "brand" | "gtm" | "exports";

export type LaunchHubAsset = {
  id: string;
  section: LaunchHubSectionId;
  filename: string;
  label: string;
  mimeType: string | null;
  phase: number | null;
  createdAt: string;
  previewUrl: string;
  downloadUrl: string;
  badge: string | null;
  isPrimary: boolean;
};

export type LaunchHubPreview = {
  url: string | null;
  liveUrl: string | null;
  status: "ready" | "not_ready";
  selectedLandingAssetId: string | null;
  selectedVariantLabel: string | null;
  updatedAt: string | null;
};

export type LaunchHubEmptyState = {
  title: string;
  description: string;
  blockers: string[];
};

export type LaunchHubResponse = {
  project: {
    id: string;
    name: string;
    phase: number;
    domain: string | null;
    runtimeMode: "shared" | "attached";
    updatedAt: string;
  };
  preview: LaunchHubPreview;
  sections: Record<LaunchHubSectionId, LaunchHubAsset[]>;
  bundle: {
    count: number;
    downloadUrl: string;
  };
  emptyState: LaunchHubEmptyState | null;
};
