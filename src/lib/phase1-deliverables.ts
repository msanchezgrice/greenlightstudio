import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { log_task } from "@/lib/supabase-mcp";
import { sendPhase1ReadyDrip } from "@/lib/drip-emails";
import { generateBrandBriefDeckSpec, generatePhase1LandingHtml, verifyLandingDesign, type ToolTrace } from "@/lib/agent";
import { generateBrandImages, uploadBrandImages } from "@/lib/brand-generator";
import { runBrandConsistencyReview } from "@/lib/brand-consistency";
import { renderBrandBriefHtml, generateBrandBriefPptx } from "@/lib/brand-presentation";
import type { Phase1Packet } from "@/types/phase-packets";

type ProjectInfo = {
  id: string;
  name: string;
  domain: string | null;
  owner_clerk_id?: string;
  idea_description: string;
};

function buildLaunchUrl(projectId: string, appBaseUrl?: string) {
  const rawBase = (appBaseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  const normalizedBase = rawBase.replace(/\/+$/, "");
  return normalizedBase ? `${normalizedBase}/launch/${projectId}` : `/launch/${projectId}`;
}

type LandingReferenceImage = {
  label: string;
  mime_type: string;
  data_base64: string;
};

function shouldUseGeminiLandingGenerator() {
  const requestedModel = process.env.PHASE1_LANDING_MODEL?.trim().toLowerCase() ?? "";
  if (requestedModel.includes("gemini-3.1-pro-preview")) return true;
  return process.env.PHASE1_LANDING_USE_GEMINI === "1";
}

async function loadLandingReferenceImages(projectId: string): Promise<LandingReferenceImage[]> {
  const db = createServiceSupabase();
  const { data: rows, error } = await withRetry(() =>
    db
      .from("project_assets")
      .select("id,filename,mime_type,storage_bucket,storage_path,metadata")
      .eq("project_id", projectId)
      .eq("status", "uploaded")
      .order("created_at", { ascending: false })
      .limit(80),
  );
  if (error) return [];

  const ranked = (rows ?? [])
    .map((row) => {
      const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
      const filename = String(row.filename ?? "");
      const isImage = typeof row.mime_type === "string" && row.mime_type.startsWith("image/");
      if (!isImage) return null;
      const isBrandAsset = metadata.brand_asset === true || metadata.phase0_brand_foundation === true;
      if (!isBrandAsset) return null;
      const rank =
        filename === "logo.png"
          ? 0
          : filename === "hero.png"
            ? 1
            : filename === "website-feature.png"
              ? 2
              : filename === "website-product.png"
                ? 3
                : filename === "social-square.png"
                  ? 4
                  : 8;
      return {
        id: String(row.id),
        filename,
        mime_type: String(row.mime_type),
        storage_bucket: String(row.storage_bucket),
        storage_path: String(row.storage_path),
        label: typeof metadata.label === "string" ? metadata.label : filename,
        rank,
      };
    })
    .filter(
      (
        row,
      ): row is {
        id: string;
        filename: string;
        mime_type: string;
        storage_bucket: string;
        storage_path: string;
        label: string;
        rank: number;
      } => Boolean(row),
    )
    .sort((left, right) => left.rank - right.rank)
    .slice(0, 4);

  const out: LandingReferenceImage[] = [];
  for (const asset of ranked) {
    const { data: file, error: downloadError } = await db.storage.from(asset.storage_bucket).download(asset.storage_path);
    if (downloadError || !file) continue;
    const bytes = Buffer.from(await file.arrayBuffer());
    out.push({
      label: asset.label,
      mime_type: asset.mime_type,
      data_base64: bytes.toString("base64"),
    });
  }
  return out;
}

export async function generatePhase1Deliverables(
  project: ProjectInfo,
  packet: Phase1Packet,
  appBaseUrl?: string,
): Promise<{ landingUrl: string | null; assetIds: string[] }> {
  const db = createServiceSupabase();
  const assetIds: string[] = [];
  let landingUrl: string | null = null;
  let landingVariants: Array<{
    assetId: string;
    index: number;
    score: number;
    pass: boolean;
    selected: boolean;
    previewUrl: string;
    createdAt: string;
  }> = [];

  const landingTrack = async () => {
    const MAX_LANDING_VARIANTS = 3;
    const useGeminiLanding = shouldUseGeminiLandingGenerator();
    const referenceImages = useGeminiLanding ? await loadLandingReferenceImages(project.id) : [];
    await log_task(project.id, "design_agent", "phase1_landing_deploy", "running", "Agent designing production landing page (frontend-design skill)");

    const landingInput = {
      project_name: project.name,
      domain: project.domain,
      idea_description: project.idea_description,
      brand_kit: packet.brand_kit,
      landing_page: packet.landing_page,
      waitlist_fields: packet.waitlist.form_fields,
      project_id: project.id,
    };

    const traces: ToolTrace[] = [];
    const generatedVariants: Array<{
      index: number;
      html: string;
      score: number;
      pass: boolean;
      feedback: string;
      assetId: string;
      storagePath: string;
      createdAt: string;
    }> = [];

    let reviewGuidance: string | undefined;
    let regenTaskStarted = false;
    let regenTaskFinalized = false;

    try {
      for (let attempt = 1; attempt <= MAX_LANDING_VARIANTS; attempt += 1) {
        await log_task(
          project.id,
          "design_agent",
          `phase1_landing_variant_${attempt}`,
          "running",
          attempt === 1
            ? "Generating initial landing variant"
            : `Generating landing variant ${attempt} with design critique guidance`,
        ).catch(() => {});

        const agentResult = await generatePhase1LandingHtml({
          ...landingInput,
          improvement_guidance: reviewGuidance,
          reference_images: referenceImages,
          preferred_model: useGeminiLanding ? "gemini" : "anthropic",
        });
        traces.push(...agentResult.traces);

        const review = await verifyLandingDesign(agentResult.html, packet.brand_kit);
        await log_task(
          project.id,
          "design_agent",
          "phase1_landing_review",
          "completed",
          `Variant ${attempt} score: ${review.score}/100 — ${review.feedback.slice(0, 220)}`,
        ).catch(() => {});

        const createdAt = new Date().toISOString();
        const storagePath = `${project.id}/deployments/landing-v${attempt}-${Date.now()}.html`;
        const upload = await withRetry(() =>
          db.storage.from("project-assets").upload(storagePath, new TextEncoder().encode(agentResult.html), {
            contentType: "text/html; charset=utf-8",
            upsert: true,
          }),
        );
        if (upload.error) throw new Error(upload.error.message);

        const assetMetadata = {
          auto_generated: true,
          landing_variant: true,
          variant_index: attempt,
          design_score: review.score,
          design_pass: review.pass,
          design_feedback: review.feedback.slice(0, 1200),
          selected_variant: false,
        };

        const { data: asset, error: assetError } = await withRetry(() =>
          db
            .from("project_assets")
            .insert({
              project_id: project.id,
              phase: 1,
              kind: "landing_html",
              storage_bucket: "project-assets",
              storage_path: storagePath,
              filename: `landing-v${attempt}.html`,
              mime_type: "text/html",
              size_bytes: Buffer.byteLength(agentResult.html, "utf8"),
              status: "uploaded",
              metadata: assetMetadata,
              created_by: project.owner_clerk_id ?? "system",
            })
            .select("id")
            .single(),
        );
        if (assetError || !asset?.id) throw new Error(assetError?.message ?? "Failed to save landing variant asset");

        assetIds.push(asset.id);
        generatedVariants.push({
          index: attempt,
          html: agentResult.html,
          score: review.score,
          pass: review.pass,
          feedback: review.feedback,
          assetId: asset.id as string,
          storagePath,
          createdAt,
        });

        await log_task(
          project.id,
          "design_agent",
          `phase1_landing_variant_${attempt}`,
          "completed",
          `Stored landing variant ${attempt} (score ${review.score}/100)`,
        ).catch(() => {});

        if (review.pass) {
          if (regenTaskStarted && !regenTaskFinalized) {
            await log_task(
              project.id,
              "design_agent",
              "phase1_landing_regen",
              "completed",
              `Refinement complete after ${attempt} variants. Selected variant ${attempt} (${review.score}/100).`,
            ).catch(() => {});
            regenTaskFinalized = true;
          }
          break;
        }

        if (attempt < MAX_LANDING_VARIANTS) {
          if (!regenTaskStarted) {
            regenTaskStarted = true;
          }
          await log_task(
            project.id,
            "design_agent",
            "phase1_landing_regen",
            "running",
            `Variant ${attempt} scored ${review.score}/100. Regenerating with critique guidance.`,
          ).catch(() => {});
          reviewGuidance = review.feedback || "Increase visual hierarchy, stronger composition, and sharper typography contrast.";
        }
      }
    } catch (error) {
      if (regenTaskStarted && !regenTaskFinalized) {
        const msg = error instanceof Error ? error.message : "Landing regeneration failed";
        await log_task(project.id, "design_agent", "phase1_landing_regen", "failed", msg).catch(() => {});
      }
      throw error;
    }

    if (!generatedVariants.length) {
      throw new Error("Landing generation produced no variants.");
    }

    const selectedVariant = [...generatedVariants].sort((a, b) => {
      if (Number(b.pass) !== Number(a.pass)) return Number(b.pass) - Number(a.pass);
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })[0];

    if (regenTaskStarted && !regenTaskFinalized) {
      await log_task(
        project.id,
        "design_agent",
        "phase1_landing_regen",
        "completed",
        selectedVariant.pass
          ? `Refinement complete. Selected variant ${selectedVariant.index} (${selectedVariant.score}/100).`
          : `No variant met quality threshold. Selected best variant ${selectedVariant.index} (${selectedVariant.score}/100).`,
      ).catch(() => {});
      regenTaskFinalized = true;
    }

    await Promise.all(
      generatedVariants.map((variant) =>
        withRetry(() =>
          db
            .from("project_assets")
            .update({
              metadata: {
                auto_generated: true,
                landing_variant: true,
                variant_index: variant.index,
                design_score: variant.score,
                design_pass: variant.pass,
                design_feedback: variant.feedback.slice(0, 1200),
                selected_variant: variant.assetId === selectedVariant.assetId,
              },
            })
            .eq("id", variant.assetId),
        ),
      ),
    );

    landingVariants = generatedVariants.map((variant) => ({
      assetId: variant.assetId,
      index: variant.index,
      score: variant.score,
      pass: variant.pass,
      selected: variant.assetId === selectedVariant.assetId,
      previewUrl: `/api/projects/${project.id}/assets/${variant.assetId}/preview`,
      createdAt: variant.createdAt,
    }));

    landingUrl = buildLaunchUrl(project.id, appBaseUrl);
    await Promise.all([
      withRetry(() =>
        db.from("project_deployments").upsert(
          {
            project_id: project.id,
            phase: 1,
            status: "ready",
            html_content: selectedVariant.html,
            metadata: {
              asset_id: selectedVariant.assetId,
              storage_path: selectedVariant.storagePath,
              auto_generated: true,
              selected_variant_index: selectedVariant.index,
              selected_score: selectedVariant.score,
              landing_variants: landingVariants.map((variant) => ({
                asset_id: variant.assetId,
                variant_index: variant.index,
                score: variant.score,
                pass: variant.pass,
                selected: variant.selected,
              })),
            },
            deployed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "project_id" },
        ),
      ),
      withRetry(() =>
        db
          .from("projects")
          .update({ deploy_status: "ready", live_url: landingUrl, updated_at: new Date().toISOString() })
          .eq("id", project.id),
      ),
    ]);

    await log_task(
      project.id,
      "design_agent",
      "phase1_landing_deploy",
      "completed",
      `${landingUrl ?? "Landing page deployed"} | selected v${selectedVariant.index} (${selectedVariant.score}/100)`,
    );
  };

  const brandTrack = async () => {
    await log_task(project.id, "brand_agent", "phase1_brand_assets", "running", "Generating AI brand images + presentations");

    const brandImages = await generateBrandImages(project.id, project.name, packet.brand_kit, {
      phase: 1,
      summary: packet.summary,
      variant: "brand",
    });
    const imageAssetIds = await uploadBrandImages(project.id, brandImages, project.owner_clerk_id, {
      phase: 1,
      metadata: {
        generated_by: "phase1",
      },
    });
    assetIds.push(...imageAssetIds);

    await log_task(project.id, "brand_agent", "phase1_brand_brief_spec", "running", "Design agent is composing a high-fidelity brand brief deck spec");
    const deckSpec = await generateBrandBriefDeckSpec({
      project_id: project.id,
      project_name: project.name,
      domain: project.domain,
      idea_description: project.idea_description,
      brand_kit: packet.brand_kit,
      landing_page: packet.landing_page,
      waitlist: packet.waitlist,
    });
    await log_task(
      project.id,
      "brand_agent",
      "phase1_brand_brief_spec",
      "completed",
      `Deck spec ready with ${deckSpec.slides.length} slides and direction: ${deckSpec.visual_direction.slice(0, 140)}`,
    );

    const briefHtml = renderBrandBriefHtml(project, brandImages, deckSpec);
    const briefHtmlPath = `${project.id}/brand/brand-brief.html`;
    await withRetry(() =>
      db.storage.from("project-assets").upload(briefHtmlPath, new TextEncoder().encode(briefHtml), {
        contentType: "text/html; charset=utf-8",
        upsert: true,
      }),
    );
    const { data: briefHtmlAsset } = await withRetry(() =>
      db
        .from("project_assets")
        .insert({
          project_id: project.id,
          phase: 1,
          kind: "upload",
          storage_bucket: "project-assets",
          storage_path: briefHtmlPath,
          filename: "brand-brief.html",
          mime_type: "text/html",
          size_bytes: Buffer.byteLength(briefHtml, "utf8"),
          status: "uploaded",
          metadata: { label: "Brand Brief (Presentation)", auto_generated: true, brand_brief: true },
          created_by: project.owner_clerk_id ?? "system",
        })
        .select("id")
        .single(),
    );
    if (briefHtmlAsset) assetIds.push(briefHtmlAsset.id);

    await log_task(project.id, "brand_agent", "phase1_brand_pptx", "running", "Generating PowerPoint brand brief");
    const pptxBuffer = await generateBrandBriefPptx(project, brandImages, deckSpec);
    const pptxPath = `${project.id}/brand/brand-brief.pptx`;
    await withRetry(() =>
      db.storage.from("project-assets").upload(pptxPath, pptxBuffer, {
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        upsert: true,
      }),
    );
    const { data: pptxAsset } = await withRetry(() =>
      db
        .from("project_assets")
        .insert({
          project_id: project.id,
          phase: 1,
          kind: "upload",
          storage_bucket: "project-assets",
          storage_path: pptxPath,
          filename: "brand-brief.pptx",
          mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          size_bytes: pptxBuffer.length,
          status: "uploaded",
          metadata: {
            label: "Brand Brief (PowerPoint)",
            auto_generated: true,
            brand_brief_pptx: true,
            visual_direction: deckSpec.visual_direction,
            slide_count: deckSpec.slides.length,
          },
          created_by: project.owner_clerk_id ?? "system",
        })
        .select("id")
        .single(),
    );
    if (pptxAsset) assetIds.push(pptxAsset.id);
    await log_task(project.id, "brand_agent", "phase1_brand_pptx", "completed", "PowerPoint brand brief generated");

    const totalAssets = brandImages.length + 2;
    await log_task(project.id, "brand_agent", "phase1_brand_assets", "completed", `Generated ${totalAssets} brand assets (${brandImages.length} images + HTML brief + PPTX)`);

    try {
      await runBrandConsistencyReview({
        db,
        projectId: project.id,
        ownerClerkId: project.owner_clerk_id ?? "system",
        phase: 1,
        reason: "phase1_auto",
      });
    } catch (error) {
      await log_task(
        project.id,
        "brand_agent",
        "brand_consistency_review",
        "failed",
        error instanceof Error ? error.message.slice(0, 240) : "Brand consistency review failed",
      ).catch(() => {});
    }
  };

  try {
    await landingTrack();
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Landing generation failed";
    await log_task(project.id, "design_agent", "phase1_landing_deploy", "failed", msg).catch(() => {});
    throw error;
  }

  try {
    await brandTrack();
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Brand asset generation failed";
    await log_task(project.id, "brand_agent", "phase1_brand_pptx", "failed", msg).catch(() => {});
    await log_task(project.id, "brand_agent", "phase1_brand_assets", "failed", msg).catch(() => {});
    throw error;
  }

  if (landingUrl) {
    const brandDeliverableUrls = {
      brandBriefHtml: null as string | null,
      brandBriefPptx: null as string | null,
      brandLogo: null as string | null,
      brandHero: null as string | null,
    };
    let dynamicBrandDeliverables: Array<Record<string, unknown>> = [];
    try {
      const { data: brandAssets } = await withRetry(() =>
        db
          .from("project_assets")
          .select("id,filename,metadata,mime_type,created_at")
          .eq("project_id", project.id)
          .eq("phase", 1)
          .eq("status", "uploaded")
          .order("created_at", { ascending: false }),
      );
      const byFilename = new Map<string, string>();
      const filteredBrandAssets = (brandAssets ?? []).filter((asset) => {
        const filename = String(asset.filename ?? "");
        const metadata = (asset.metadata as Record<string, unknown> | null) ?? {};
        return (
          filename === "brand-brief.html" ||
          filename === "brand-brief.pptx" ||
          metadata.brand_asset === true ||
          filename === "logo.png" ||
          filename === "hero.png"
        );
      });
      for (const asset of filteredBrandAssets) {
        const filename = String(asset.filename ?? "");
        if (!filename || byFilename.has(filename)) continue;
        byFilename.set(filename, String(asset.id));
      }
      const preview = (assetId: string | undefined) =>
        assetId ? `/api/projects/${project.id}/assets/${assetId}/preview` : null;
      brandDeliverableUrls.brandBriefHtml = preview(byFilename.get("brand-brief.html"));
      brandDeliverableUrls.brandBriefPptx = preview(byFilename.get("brand-brief.pptx"));
      brandDeliverableUrls.brandLogo = preview(byFilename.get("logo.png"));
      brandDeliverableUrls.brandHero = preview(byFilename.get("hero.png"));

      dynamicBrandDeliverables = filteredBrandAssets
        .filter((asset) => ((asset.metadata as Record<string, unknown> | null)?.brand_asset === true))
        .slice(0, 10)
        .map((asset) => ({
          kind: "brand_asset",
          label: String(((asset.metadata as Record<string, unknown> | null)?.label as string | undefined) ?? asset.filename),
          url: `/api/projects/${project.id}/assets/${asset.id}/preview`,
          status: "generated",
          generated_at: new Date().toISOString(),
        }));
    } catch {
      // Non-fatal: deliverables still render without direct URLs.
    }

    const landingDeliverables = landingVariants.length
      ? landingVariants.map((variant) => ({
          kind: "landing_html_variant",
          label: `Landing Variant ${variant.index}${variant.selected ? " (Selected)" : ""}`,
          url: variant.previewUrl,
          status: variant.selected ? "deployed" : variant.pass ? "generated" : "rejected",
          generated_at: variant.createdAt,
          score: variant.score,
        }))
      : [];

    await withRetry(() =>
      db
        .from("phase_packets")
        .update({
          deliverables: [
            { kind: "landing_html", label: "Landing Page", url: landingUrl, status: "deployed", generated_at: new Date().toISOString() },
            ...landingDeliverables,
            { kind: "brand_brief_html", label: "Brand Brief (Presentation)", url: brandDeliverableUrls.brandBriefHtml, status: "generated", generated_at: new Date().toISOString() },
            { kind: "brand_brief_pptx", label: "Brand Brief (PowerPoint)", url: brandDeliverableUrls.brandBriefPptx, status: "generated", generated_at: new Date().toISOString() },
            { kind: "brand_logo", label: "AI Logo", url: brandDeliverableUrls.brandLogo, status: "generated", generated_at: new Date().toISOString() },
            { kind: "brand_hero", label: "Hero Image", url: brandDeliverableUrls.brandHero, status: "generated", generated_at: new Date().toISOString() },
            ...dynamicBrandDeliverables,
            { kind: "brand_system", label: "Brand System", status: "generated", generated_at: new Date().toISOString() },
          ],
        })
        .eq("project_id", project.id)
        .eq("phase", 1),
    ).catch(() => {});
  }

  if (project.owner_clerk_id) {
    try {
      const { data: userRow } = await db
        .from("users")
        .select("id,email")
        .eq("clerk_id", project.owner_clerk_id)
        .maybeSingle();
      if (userRow?.email) {
        await Promise.race([
          sendPhase1ReadyDrip({
            userId: userRow.id as string,
            email: userRow.email as string,
            projectId: project.id,
            projectName: project.name,
            landingUrl,
          }),
          new Promise((resolve) =>
            setTimeout(() => resolve({ sent: false, reason: "phase1_drip_timeout" }), 15000),
          ),
        ]);
      }
    } catch {
      // non-fatal
    }
  }

  return { landingUrl, assetIds };
}
