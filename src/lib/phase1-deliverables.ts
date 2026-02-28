import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { log_task } from "@/lib/supabase-mcp";
import { sendPhase1ReadyDrip } from "@/lib/drip-emails";
import { generatePhase1LandingHtml, verifyLandingDesign, type ToolTrace } from "@/lib/agent";
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

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function buildLaunchUrl(projectId: string, appBaseUrl?: string) {
  const rawBase = (appBaseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  const normalizedBase = rawBase.replace(/\/+$/, "");
  return normalizedBase ? `${normalizedBase}/launch/${projectId}` : `/launch/${projectId}`;
}

function generateBrandLogoSvg(name: string, palette: string[]): string {
  const primary = palette[0] ?? "#6EE7B7";
  const secondary = palette[1] ?? "#3B82F6";
  const initial = name.charAt(0).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${primary}"/>
      <stop offset="100%" stop-color="${secondary}"/>
    </linearGradient>
  </defs>
  <rect width="120" height="120" rx="24" fill="url(#bg)"/>
  <text x="60" y="60" text-anchor="middle" dominant-baseline="central" fill="#fff" font-family="system-ui,-apple-system,sans-serif" font-size="52" font-weight="700">${initial}</text>
</svg>`;
}

function generateWordmarkSvg(name: string, palette: string[]): string {
  const primary = palette[0] ?? "#6EE7B7";
  const width = Math.max(200, name.length * 28 + 40);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 60" width="${width}" height="60">
  <text x="20" y="42" fill="${primary}" font-family="system-ui,-apple-system,sans-serif" font-size="36" font-weight="700" letter-spacing="-1">${escapeHtml(name)}</text>
</svg>`;
}

function renderBrandKitHtml(project: ProjectInfo, packet: Phase1Packet): string {
  const h = escapeHtml;
  const kit = packet.brand_kit;
  const primary = kit.color_palette[0] ?? "#6EE7B7";
  const secondary = kit.color_palette[1] ?? "#3B82F6";
  const bg = kit.color_palette[2] ?? "#0A0F1C";
  const logoSvg = generateBrandLogoSvg(project.name, kit.color_palette);
  const logoDataUri = `data:image/svg+xml,${encodeURIComponent(logoSvg)}`;
  const wordmarkSvg = generateWordmarkSvg(project.name, kit.color_palette);
  const wordmarkDataUri = `data:image/svg+xml,${encodeURIComponent(wordmarkSvg)}`;

  const colorSwatches = kit.color_palette
    .map(
      (c, i) => `
      <div style="text-align:center">
        <div style="width:80px;height:80px;border-radius:12px;background:${h(c)};border:1px solid rgba(255,255,255,.12);margin:0 auto 8px"></div>
        <code style="font-size:12px;color:#94A3B8">${h(c)}</code>
        <div style="font-size:11px;color:#64748B;margin-top:2px">${i === 0 ? "Primary" : i === 1 ? "Secondary" : i === 2 ? "Background" : `Accent ${i}`}</div>
      </div>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${h(project.name)} — Brand Kit</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet"/>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'DM Sans',system-ui,sans-serif;background:${bg};color:#E2E8F0;line-height:1.6;-webkit-font-smoothing:antialiased}
    .wrap{max-width:800px;margin:0 auto;padding:48px 32px 80px}
    h1{font-family:'Space Grotesk',sans-serif;font-size:36px;font-weight:700;color:#F8FAFC;margin-bottom:8px}
    h2{font-family:'Space Grotesk',sans-serif;font-size:22px;font-weight:700;color:#F8FAFC;margin:48px 0 20px;padding-top:32px;border-top:1px solid rgba(255,255,255,.08)}
    h3{font-size:14px;font-weight:600;color:#94A3B8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px}
    .subtitle{font-size:15px;color:#94A3B8;margin-bottom:40px}
    .logo-grid{display:flex;gap:32px;flex-wrap:wrap;margin-bottom:16px}
    .logo-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:32px;text-align:center;flex:1;min-width:200px}
    .logo-card img{max-height:80px;margin-bottom:12px}
    .logo-card .label{font-size:13px;color:#94A3B8}
    .logo-dark .logo-card{background:#F8FAFC;border-color:#E2E8F0}
    .palette-row{display:flex;gap:20px;flex-wrap:wrap;margin-bottom:16px}
    .type-sample{padding:24px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;margin-bottom:12px}
    .type-sample .heading-demo{font-family:'Space Grotesk',sans-serif;font-size:28px;font-weight:700;color:#F8FAFC;margin-bottom:8px}
    .type-sample .body-demo{font-family:'DM Sans',sans-serif;font-size:15px;color:#94A3B8}
    .voice-card{padding:24px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;margin-bottom:12px}
    .voice-label{font-size:13px;color:${primary};font-weight:600;margin-bottom:8px}
    .voice-text{font-size:15px;color:#CBD5E1;line-height:1.7}
    .usage-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    .usage-do,.usage-dont{padding:20px;border-radius:12px}
    .usage-do{background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.15)}
    .usage-dont{background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.15)}
    .usage-do h4{color:#22C55E;font-size:13px;margin-bottom:8px}
    .usage-dont h4{color:#EF4444;font-size:13px;margin-bottom:8px}
    .usage-do li,.usage-dont li{font-size:13px;color:#94A3B8;margin-bottom:4px}
    ul{padding-left:18px}
    .footer{margin-top:64px;padding-top:24px;border-top:1px solid rgba(255,255,255,.08);font-size:12px;color:#64748B;text-align:center}
    @media print{body{background:#fff;color:#1e293b}h1,h2,.type-sample .heading-demo{color:#0f172a}.subtitle,.logo-card .label,.voice-text,.usage-do li,.usage-dont li{color:#475569}}
    @media(max-width:640px){.wrap{padding:32px 16px}.logo-grid{flex-direction:column}.usage-grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${h(project.name)} Brand Kit</h1>
    <p class="subtitle">Brand guidelines and visual identity system. Generated by Greenlight Studio.</p>

    <h2>Logo</h2>
    <h3>Primary Marks</h3>
    <div class="logo-grid">
      <div class="logo-card">
        <img src="${logoDataUri}" alt="Logo Mark"/>
        <div class="label">Logo Mark</div>
      </div>
      <div class="logo-card">
        <img src="${wordmarkDataUri}" alt="Wordmark"/>
        <div class="label">Wordmark</div>
      </div>
    </div>
    <h3>On Light Background</h3>
    <div class="logo-grid logo-dark">
      <div class="logo-card">
        <img src="${logoDataUri}" alt="Logo Mark on Light"/>
        <div class="label" style="color:#64748B">Logo Mark — Light</div>
      </div>
      <div class="logo-card">
        <img src="${wordmarkDataUri}" alt="Wordmark on Light"/>
        <div class="label" style="color:#64748B">Wordmark — Light</div>
      </div>
    </div>

    <h2>Color Palette</h2>
    <div class="palette-row">${colorSwatches}</div>

    <h2>Typography</h2>
    <h3>${h(kit.font_pairing)}</h3>
    <div class="type-sample">
      <div class="heading-demo">The quick brown fox jumps over the lazy dog</div>
      <div class="body-demo">Body text uses DM Sans for readability across all screen sizes. Headings use Space Grotesk for a modern, geometric feel that pairs well with the brand's technical identity.</div>
    </div>

    <h2>Voice &amp; Tone</h2>
    <div class="voice-card">
      <div class="voice-label">Brand Voice</div>
      <div class="voice-text">${h(kit.voice)}</div>
    </div>

    <h2>Logo Concept</h2>
    <div class="voice-card">
      <div class="voice-label">Design Direction</div>
      <div class="voice-text">${h(kit.logo_prompt)}</div>
    </div>

    <h2>Usage Guidelines</h2>
    <div class="usage-grid">
      <div class="usage-do">
        <h4>Do</h4>
        <ul>
          <li>Use the logo mark at minimum 32px</li>
          <li>Maintain clear space equal to the mark's height</li>
          <li>Use brand colors consistently across all touchpoints</li>
          <li>Pair Space Grotesk headings with DM Sans body text</li>
        </ul>
      </div>
      <div class="usage-dont">
        <h4>Don't</h4>
        <ul>
          <li>Stretch or distort the logo proportions</li>
          <li>Place the logo on busy backgrounds without contrast</li>
          <li>Use more than 2 brand colors in a single layout</li>
          <li>Substitute the specified typefaces</li>
        </ul>
      </div>
    </div>

    <p class="footer">
      ${h(project.name)} Brand Kit &middot; Generated ${new Date().toLocaleDateString()} &middot; Greenlight Studio
    </p>
  </div>
</body>
</html>`;
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

    const baseUrl = appBaseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const imageUrls: Record<string, string> = {};
    for (const img of brandImages) {
      const key = img.filename.replace(/\.\w+$/, "");
      const { data: pub } = db.storage.from("project-assets").getPublicUrl(img.storagePath);
      imageUrls[key] = pub?.publicUrl ?? `${baseUrl}/api/projects/${project.id}/assets/preview?path=${encodeURIComponent(img.storagePath)}`;
    }

    const briefHtml = renderBrandBriefHtml(project, packet, imageUrls);
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
    const pptxBuffer = await generateBrandBriefPptx(project, packet, brandImages);
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
          metadata: { label: "Brand Brief (PowerPoint)", auto_generated: true, brand_brief_pptx: true },
          created_by: project.owner_clerk_id ?? "system",
        })
        .select("id")
        .single(),
    );
    if (pptxAsset) assetIds.push(pptxAsset.id);

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
            { kind: "brand_assets", label: "Brand Kit Document", status: "generated", generated_at: new Date().toISOString() },
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
