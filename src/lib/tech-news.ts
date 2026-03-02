import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { log_task } from "@/lib/supabase-mcp";
import { generateTechNewsInsights, type TechNewsInsight } from "@/lib/agent";
import { recordProjectEvent } from "@/lib/project-events";

type RefreshOptions = {
  db?: SupabaseClient;
  projectId: string;
  reason?: "phase0" | "nightshift" | "scheduled" | "manual";
  ownerClerkId?: string | null;
};

function renderInsightMarkdown(input: {
  projectName: string;
  domain: string | null;
  phase: number;
  insight: TechNewsInsight;
}) {
  const lines: string[] = [];
  lines.push(`# Tech + AI News Relevance — ${input.projectName}`);
  lines.push("");
  lines.push(`- generated_at: ${new Date().toISOString()}`);
  lines.push(`- domain: ${input.domain ?? "n/a"}`);
  lines.push(`- phase: ${input.phase}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(input.insight.summary);
  lines.push("");
  lines.push("## Relevant Advances");
  input.insight.advances.forEach((entry, index) => {
    lines.push(`### ${index + 1}. ${entry.headline}`);
    lines.push(`- Relevance: ${entry.relevance}`);
    lines.push(`- Application: ${entry.application}`);
    lines.push(`- Source: ${entry.source}`);
    lines.push("");
  });
  lines.push("## Recommended Actions");
  input.insight.recommendations.forEach((entry, index) => {
    lines.push(`${index + 1}. ${entry}`);
  });
  return lines.join("\n");
}

export async function refreshProjectTechNewsInsights(options: RefreshOptions) {
  const db = options.db ?? createServiceSupabase();
  const reason = options.reason ?? "manual";

  const [{ data: project, error: projectError }, { data: packetRow }, { data: brainRow }] = await Promise.all([
    db
      .from("projects")
      .select("id,name,domain,phase,idea_description,owner_clerk_id")
      .eq("id", options.projectId)
      .single(),
    db
      .from("phase_packets")
      .select("phase,packet,packet_data")
      .eq("project_id", options.projectId)
      .order("phase", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("project_brain_documents")
      .select("mission_markdown")
      .eq("project_id", options.projectId)
      .maybeSingle(),
  ]);

  if (projectError || !project) {
    throw new Error(projectError?.message ?? "Project not found for tech-news refresh");
  }

  const ownerClerkId =
    options.ownerClerkId ??
    (typeof project.owner_clerk_id === "string" && project.owner_clerk_id.trim().length > 0
      ? project.owner_clerk_id
      : "system");

  await log_task(
    options.projectId,
    "research_agent",
    "tech_news_refresh",
    "running",
    `Refreshing tech-news relevance (${reason})`,
  ).catch(() => {});

  const packetPayload = (packetRow?.packet_data ?? packetRow?.packet) as unknown;

  const insight = await generateTechNewsInsights({
    project_id: options.projectId,
    project_name: String(project.name ?? "Project"),
    domain: (project.domain as string | null) ?? null,
    idea_description: String(project.idea_description ?? ""),
    phase: Number(project.phase ?? 0),
    mission: typeof brainRow?.mission_markdown === "string" ? brainRow.mission_markdown : null,
    packet_excerpt: packetPayload,
  });

  const markdown = renderInsightMarkdown({
    projectName: String(project.name ?? "Project"),
    domain: (project.domain as string | null) ?? null,
    phase: Number(project.phase ?? 0),
    insight,
  });

  const phase = Number(packetRow?.phase ?? project.phase ?? 0);
  const storagePath = `${options.projectId}/research/tech-news-insights.md`;
  await withRetry(() =>
    db.storage.from("project-assets").upload(storagePath, Buffer.from(markdown, "utf8"), {
      contentType: "text/markdown; charset=utf-8",
      upsert: true,
    }),
  );

  const { data: asset } = await withRetry(() =>
    db
      .from("project_assets")
      .upsert(
        {
          project_id: options.projectId,
          phase,
          kind: "upload",
          storage_bucket: "project-assets",
          storage_path: storagePath,
          filename: "tech-news-insights.md",
          mime_type: "text/markdown",
          size_bytes: Buffer.byteLength(markdown, "utf8"),
          status: "uploaded",
          metadata: {
            auto_generated: true,
            tech_news_insights: true,
            reason,
            advances_count: insight.advances.length,
          },
          created_by: ownerClerkId,
        },
        { onConflict: "project_id,storage_path" },
      )
      .select("id")
      .single(),
  );

  await recordProjectEvent(db, {
    projectId: options.projectId,
    eventType: "research.tech_news_refreshed",
    message: `Tech-news insights refreshed (${insight.advances.length} advances)` ,
    data: {
      reason,
      advances_count: insight.advances.length,
      asset_id: asset?.id ?? null,
      summary_preview: insight.summary.slice(0, 220),
    },
    agentKey: "research",
  });

  await log_task(
    options.projectId,
    "research_agent",
    "tech_news_refresh",
    "completed",
    `Tech-news relevance refreshed with ${insight.advances.length} advances`,
  ).catch(() => {});

  return {
    assetId: (asset?.id as string | undefined) ?? null,
    insight,
  };
}
