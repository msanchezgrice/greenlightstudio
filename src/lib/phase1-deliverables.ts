import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { log_task } from "@/lib/supabase-mcp";
import { sendPhase1ReadyDrip } from "@/lib/drip-emails";
import { generateBrandBriefDeckSpec, generatePhase1LandingHtml, verifyLandingDesign, type ToolTrace } from "@/lib/agent";
import { generateBrandImages, uploadBrandImages } from "@/lib/brand-generator";
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

    if (traces.length > 0) {
      const traceLog = traces.map((t) => `${t.tool}(${t.input_preview.slice(0, 80)})`).join(" → ");
      await log_task(project.id, "design_agent", "phase1_landing_traces", "completed", `Tool trace: ${traceLog.slice(0, 300)}`).catch(() => {});
    }

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

    const brandImages = await generateBrandImages(project.id, project.name, packet.brand_kit);
    const imageAssetIds = await uploadBrandImages(project.id, brandImages, project.owner_clerk_id);
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
    try {
      const { data: brandAssets } = await withRetry(() =>
        db
          .from("project_assets")
          .select("id,filename,created_at")
          .eq("project_id", project.id)
          .in("filename", ["brand-brief.html", "brand-brief.pptx", "logo.png", "hero.png"])
          .order("created_at", { ascending: false }),
      );
      const byFilename = new Map<string, string>();
      for (const asset of brandAssets ?? []) {
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
