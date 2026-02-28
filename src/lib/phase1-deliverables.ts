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

  const landingTrack = async () => {
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

    const agentResult = await generatePhase1LandingHtml(landingInput);
    let html = agentResult.html;
    let traces: ToolTrace[] = agentResult.traces;

    const review = await verifyLandingDesign(html, packet.brand_kit);
    await log_task(project.id, "design_agent", "phase1_landing_review", "completed", `Design score: ${review.score}/100 — ${review.feedback.slice(0, 200)}`).catch(() => {});

    if (!review.pass) {
      await log_task(project.id, "design_agent", "phase1_landing_regen", "running", `Score ${review.score} below threshold, regenerating with feedback`);
      const retry = await generatePhase1LandingHtml(landingInput);
      html = retry.html;
      traces = [...traces, ...retry.traces];
    }

    if (traces.length > 0) {
      const traceLog = traces.map((t) => `${t.tool}(${t.input_preview.slice(0, 80)})`).join(" → ");
      await log_task(project.id, "design_agent", "phase1_landing_traces", "completed", `Tool trace: ${traceLog.slice(0, 300)}`).catch(() => {});
    }

    const deploymentPath = `${project.id}/deployments/landing-${Date.now()}.html`;

    const upload = await withRetry(() =>
      db.storage.from("project-assets").upload(deploymentPath, new TextEncoder().encode(html), {
        contentType: "text/html; charset=utf-8",
        upsert: true,
      }),
    );
    if (upload.error) throw new Error(upload.error.message);

    const { data: asset } = await withRetry(() =>
      db
        .from("project_assets")
        .insert({
          project_id: project.id,
          phase: 1,
          kind: "landing_html",
          storage_bucket: "project-assets",
          storage_path: deploymentPath,
          filename: "index.html",
          mime_type: "text/html",
          size_bytes: Buffer.byteLength(html, "utf8"),
          status: "uploaded",
          metadata: { auto_generated: true },
          created_by: project.owner_clerk_id ?? "system",
        })
        .select("id")
        .single(),
    );
    if (asset) assetIds.push(asset.id);

    landingUrl = buildLaunchUrl(project.id, appBaseUrl);

    await Promise.all([
      withRetry(() =>
        db.from("project_deployments").upsert(
          {
            project_id: project.id,
            phase: 1,
            status: "ready",
            html_content: html,
            metadata: { asset_id: asset?.id, storage_path: deploymentPath, auto_generated: true },
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

    await log_task(project.id, "design_agent", "phase1_landing_deploy", "completed", landingUrl ?? "Landing page deployed");
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
    await withRetry(() =>
      db
        .from("phase_packets")
        .update({
          deliverables: [
            { kind: "landing_html", label: "Landing Page", url: landingUrl, status: "deployed", generated_at: new Date().toISOString() },
            { kind: "brand_brief_html", label: "Brand Brief (Presentation)", status: "generated", generated_at: new Date().toISOString() },
            { kind: "brand_brief_pptx", label: "Brand Brief (PowerPoint)", status: "generated", generated_at: new Date().toISOString() },
            { kind: "brand_logo", label: "AI Logo", status: "generated", generated_at: new Date().toISOString() },
            { kind: "brand_hero", label: "Hero Image", status: "generated", generated_at: new Date().toISOString() },
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
        await sendPhase1ReadyDrip({
          userId: userRow.id as string,
          email: userRow.email as string,
          projectId: project.id,
          projectName: project.name,
          landingUrl,
        });
      }
    } catch {
      // non-fatal
    }
  }

  return { landingUrl, assetIds };
}
