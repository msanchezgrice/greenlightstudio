import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { log_task } from "@/lib/supabase-mcp";
import { generateBrandImages, uploadBrandImages } from "@/lib/brand-generator";
import { phase1PacketSchema, type Phase2Packet } from "@/types/phase-packets";

type ProjectInfo = {
  id: string;
  name: string;
  domain: string | null;
  idea_description: string;
  owner_clerk_id?: string | null;
};

function fallbackBrandKit(project: ProjectInfo) {
  return {
    voice: `Confident and practical for ${project.name}`,
    color_palette: ["#0B1F3A", "#22C55E", "#38BDF8", "#F8FAFC"],
    font_pairing: "Sora + Inter",
    logo_prompt: `Minimal geometric logo for ${project.name}`,
  };
}

function renderMarketingMarkdown(input: {
  project: ProjectInfo;
  packet: Phase2Packet;
  imageUrls: string[];
}) {
  const lines: string[] = [];
  lines.push(`# Phase 2 Social + Marketing Asset Pack — ${input.project.name}`);
  lines.push("");
  lines.push(`- generated_at: ${new Date().toISOString()}`);
  lines.push(`- project: ${input.project.name}`);
  lines.push(`- phase: 2`);
  lines.push("");
  lines.push("## Distribution North Star");
  lines.push(input.packet.distribution_strategy.north_star_metric);
  lines.push("");
  lines.push("## Channel Plan");
  input.packet.distribution_strategy.channel_plan.forEach((row, idx) => {
    lines.push(`${idx + 1}. ${row.channel} — ${row.objective} (weekly budget: ${row.weekly_budget})`);
  });
  lines.push("");
  lines.push("## Creative Angles");
  input.packet.paid_acquisition.creative_angles.forEach((angle, idx) => {
    lines.push(`${idx + 1}. ${angle}`);
  });
  lines.push("");
  lines.push("## Lifecycle Journeys");
  input.packet.lifecycle_email.journeys.forEach((journey, idx) => {
    lines.push(`${idx + 1}. ${journey}`);
  });
  lines.push("");
  lines.push("## Weekly Experiments");
  input.packet.weekly_experiments.forEach((experiment, idx) => {
    lines.push(`${idx + 1}. ${experiment}`);
  });
  lines.push("");
  lines.push("## Asset URLs");
  if (input.imageUrls.length === 0) {
    lines.push("- No image assets generated.");
  } else {
    input.imageUrls.forEach((url: string) => lines.push(`- ${url}`));
  }

  return lines.join("\n");
}

export async function generatePhase2Deliverables(project: ProjectInfo, packet: Phase2Packet) {
  const db = createServiceSupabase();
  await log_task(project.id, "growth_agent", "phase2_social_assets", "running", "Generating social and marketing assets").catch(() => {});

  const phase1PacketRes = await withRetry(() =>
    db
      .from("phase_packets")
      .select("packet,packet_data")
      .eq("project_id", project.id)
      .eq("phase", 1)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );

  let brandKit = fallbackBrandKit(project);
  const phase1Payload = (phase1PacketRes.data?.packet_data ?? phase1PacketRes.data?.packet) as unknown;
  const parsedPhase1 = phase1PacketSchema.safeParse(phase1Payload);
  if (parsedPhase1.success) {
    brandKit = parsedPhase1.data.brand_kit;
  }

  const marketingImages = await generateBrandImages(project.id, project.name, brandKit, {
    phase: 2,
    summary: packet.summary,
    variant: "marketing",
  });
  const marketingAssetIds = await uploadBrandImages(project.id, marketingImages, project.owner_clerk_id ?? undefined, {
    phase: 2,
    metadata: {
      phase2_marketing_assets: true,
      generated_by: "phase2",
    },
  });

  const imageUrls = marketingAssetIds
    .map((assetId) => (assetId ? `/api/projects/${project.id}/assets/${assetId}/preview` : null))
    .filter((value): value is string => Boolean(value));

  const markdown = renderMarketingMarkdown({
    project,
    packet,
    imageUrls,
  });
  const planPath = `${project.id}/phase-2/social-marketing-plan.md`;
  await withRetry(() =>
    db.storage.from("project-assets").upload(planPath, Buffer.from(markdown, "utf8"), {
      contentType: "text/markdown; charset=utf-8",
      upsert: true,
    }),
  );

  const { data: planAsset } = await withRetry(() =>
    db
      .from("project_assets")
      .insert({
        project_id: project.id,
        phase: 2,
        kind: "upload",
        storage_bucket: "project-assets",
        storage_path: planPath,
        filename: "social-marketing-plan.md",
        mime_type: "text/markdown",
        size_bytes: Buffer.byteLength(markdown, "utf8"),
        status: "uploaded",
        metadata: {
          auto_generated: true,
          phase2_marketing_plan: true,
          label: "Social + Marketing Plan",
        },
        created_by: project.owner_clerk_id ?? "system",
      })
      .select("id")
      .single(),
  );

  const deliverables: Array<Record<string, unknown>> = [
    {
      kind: "phase2_marketing_plan",
      label: "Social + Marketing Plan",
      url: planAsset?.id ? `/api/projects/${project.id}/assets/${planAsset.id}/preview` : null,
      storage_path: planPath,
      status: "generated",
      generated_at: new Date().toISOString(),
    },
  ];

  for (let index = 0; index < marketingAssetIds.length; index += 1) {
    const assetId = marketingAssetIds[index];
    const image = marketingImages[index];
    if (!assetId || !image) continue;
    deliverables.push({
      kind: "phase2_social_asset",
      label: image.label,
      url: `/api/projects/${project.id}/assets/${assetId}/preview`,
      storage_path: image.storagePath,
      status: "generated",
      generated_at: new Date().toISOString(),
    });
  }

  await log_task(
    project.id,
    "growth_agent",
    "phase2_social_assets",
    "completed",
    `Generated ${deliverables.length} Phase 2 social and marketing assets`,
  ).catch(() => {});

  return {
    deliverables,
    marketingAssetIds,
    planAssetId: (planAsset?.id as string | undefined) ?? null,
  };
}
