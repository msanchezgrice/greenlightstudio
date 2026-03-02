import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { log_task } from "@/lib/supabase-mcp";
import type { Packet } from "@/types/domain";
import { generatePhase0BrandKit, generateBrandBriefDeckSpec } from "@/lib/agent";
import { generateBrandImages, uploadBrandImages } from "@/lib/brand-generator";
import { renderBrandBriefHtml, generateBrandBriefPptx } from "@/lib/brand-presentation";
import { createPhasePacketPresentationAssets, readPacketSummaryForPhase } from "@/lib/phase-presentations";
import { refreshProjectTechNewsInsights } from "@/lib/tech-news";

type Input = {
  projectId: string;
  projectName: string;
  domain: string | null;
  ideaDescription: string;
  packet: Packet;
  scanResults?: Record<string, unknown> | null;
  ownerClerkId?: string | null;
  mission?: string | null;
};

export async function generatePhase0Foundations(input: Input) {
  const db = createServiceSupabase();
  const deliverables: Array<Record<string, unknown>> = [];

  await log_task(input.projectId, "ceo_agent", "phase0_packet_deck", "running", "Generating Phase 0 packet deck assets").catch(() => {});
  const packetDeck = await createPhasePacketPresentationAssets({
    projectId: input.projectId,
    phase: 0,
    projectName: input.projectName,
    domain: input.domain,
    packet: input.packet,
    summary: readPacketSummaryForPhase(0, input.packet),
    ownerClerkId: input.ownerClerkId,
  });
  await log_task(input.projectId, "ceo_agent", "phase0_packet_deck", "completed", "Phase 0 packet deck assets generated").catch(() => {});

  if (packetDeck.htmlPreviewUrl) {
    deliverables.push({
      kind: "phase0_packet_html",
      label: "Phase 0 Packet Deck (HTML)",
      url: packetDeck.htmlPreviewUrl,
      storage_path: null,
      status: "generated",
      generated_at: new Date().toISOString(),
    });
  }
  if (packetDeck.pptxPreviewUrl) {
    deliverables.push({
      kind: "phase0_packet_pptx",
      label: "Phase 0 Packet Deck (PowerPoint)",
      url: packetDeck.pptxPreviewUrl,
      storage_path: null,
      status: "generated",
      generated_at: new Date().toISOString(),
    });
  }

  await log_task(input.projectId, "brand_agent", "phase0_brand_foundation", "running", "Building Phase 0 brand foundation assets").catch(() => {});
  const brandKit = await generatePhase0BrandKit({
    project_id: input.projectId,
    project_name: input.projectName,
    domain: input.domain,
    idea_description: input.ideaDescription,
    packet: input.packet,
    scan_results: input.scanResults ?? null,
    mission: input.mission ?? null,
  });

  const brandImages = await generateBrandImages(input.projectId, input.projectName, brandKit, {
    phase: 0,
    summary: input.packet.elevator_pitch,
    variant: "brand",
  });
  const imageAssetIds = await uploadBrandImages(input.projectId, brandImages, input.ownerClerkId ?? undefined, {
    phase: 0,
    metadata: {
      phase0_brand_foundation: true,
      generated_by: "phase0",
    },
  });

  for (let index = 0; index < imageAssetIds.length; index += 1) {
    const image = brandImages[index];
    const assetId = imageAssetIds[index];
    if (!assetId) continue;
    deliverables.push({
      kind: "brand_asset",
      label: image.label,
      url: `/api/projects/${input.projectId}/assets/${assetId}/preview`,
      storage_path: image.storagePath,
      status: "generated",
      generated_at: new Date().toISOString(),
    });
  }

  const deckSpec = await generateBrandBriefDeckSpec({
    project_id: input.projectId,
    project_name: input.projectName,
    domain: input.domain,
    idea_description: input.ideaDescription,
    brand_kit: brandKit,
    landing_page: {
      headline: input.packet.tagline,
      subheadline: input.packet.elevator_pitch,
      primary_cta: "Join Early Access",
      sections: input.packet.mvp_scope.in_scope.slice(0, 4),
      launch_notes: input.packet.reasoning_synopsis.next_actions.slice(0, 4),
    },
    waitlist: {
      capture_stack: "Startup Machine hosted waitlist",
      double_opt_in: true,
      form_fields: ["Email", "Name"],
      target_conversion_rate: "8-15%",
    },
  });

  const briefHtml = renderBrandBriefHtml(
    {
      id: input.projectId,
      name: input.projectName,
      domain: input.domain,
      idea_description: input.ideaDescription,
    },
    brandImages,
    deckSpec,
  );
  const briefHtmlPath = `${input.projectId}/phase-0/brand/brand-brief.html`;
  const briefPptxPath = `${input.projectId}/phase-0/brand/brand-brief.pptx`;
  const briefPptx = await generateBrandBriefPptx(
    {
      id: input.projectId,
      name: input.projectName,
      domain: input.domain,
      idea_description: input.ideaDescription,
    },
    brandImages,
    deckSpec,
  );

  await Promise.all([
    withRetry(() =>
      db.storage.from("project-assets").upload(briefHtmlPath, Buffer.from(briefHtml, "utf8"), {
        contentType: "text/html; charset=utf-8",
        upsert: true,
      }),
    ),
    withRetry(() =>
      db.storage.from("project-assets").upload(briefPptxPath, briefPptx, {
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        upsert: true,
      }),
    ),
  ]);

  const [briefHtmlAsset, briefPptxAsset] = await Promise.all([
    withRetry(() =>
      db
        .from("project_assets")
        .insert({
          project_id: input.projectId,
          phase: 0,
          kind: "upload",
          storage_bucket: "project-assets",
          storage_path: briefHtmlPath,
          filename: "brand-brief.html",
          mime_type: "text/html",
          size_bytes: Buffer.byteLength(briefHtml, "utf8"),
          status: "uploaded",
          metadata: {
            label: "Brand Brief (Phase 0)",
            auto_generated: true,
            brand_brief: true,
            phase0_brand_foundation: true,
          },
          created_by: input.ownerClerkId ?? "system",
        })
        .select("id")
        .single(),
    ),
    withRetry(() =>
      db
        .from("project_assets")
        .insert({
          project_id: input.projectId,
          phase: 0,
          kind: "upload",
          storage_bucket: "project-assets",
          storage_path: briefPptxPath,
          filename: "brand-brief.pptx",
          mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          size_bytes: briefPptx.length,
          status: "uploaded",
          metadata: {
            label: "Brand Brief Deck (Phase 0)",
            auto_generated: true,
            brand_brief_pptx: true,
            phase0_brand_foundation: true,
          },
          created_by: input.ownerClerkId ?? "system",
        })
        .select("id")
        .single(),
    ),
  ]);

  if (briefHtmlAsset.data?.id) {
    deliverables.push({
      kind: "phase0_brand_brief_html",
      label: "Brand Brief (HTML)",
      url: `/api/projects/${input.projectId}/assets/${briefHtmlAsset.data.id}/preview`,
      storage_path: briefHtmlPath,
      status: "generated",
      generated_at: new Date().toISOString(),
    });
  }
  if (briefPptxAsset.data?.id) {
    deliverables.push({
      kind: "phase0_brand_brief_pptx",
      label: "Brand Brief (PowerPoint)",
      url: `/api/projects/${input.projectId}/assets/${briefPptxAsset.data.id}/preview`,
      storage_path: briefPptxPath,
      status: "generated",
      generated_at: new Date().toISOString(),
    });
  }

  await log_task(
    input.projectId,
    "brand_agent",
    "phase0_brand_foundation",
    "completed",
    `Generated ${brandImages.length + 2} Phase 0 brand assets`,
  ).catch(() => {});

  const techNews = await refreshProjectTechNewsInsights({
    db,
    projectId: input.projectId,
    reason: "phase0",
    ownerClerkId: input.ownerClerkId ?? null,
  });

  if (techNews.assetId) {
    deliverables.push({
      kind: "phase0_tech_news",
      label: "Tech + AI News Relevance",
      url: `/api/projects/${input.projectId}/assets/${techNews.assetId}/preview`,
      storage_path: `${input.projectId}/research/tech-news-insights.md`,
      status: "generated",
      generated_at: new Date().toISOString(),
    });
  }

  await withRetry(() =>
    db
      .from("phase_packets")
      .update({
        deliverables,
      })
      .eq("project_id", input.projectId)
      .eq("phase", 0),
  );

  return {
    deliverables,
    brandKit,
    highlights: packetDeck.highlights,
    techNews: techNews.insight,
  };
}
