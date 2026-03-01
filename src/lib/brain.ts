import type { SupabaseClient } from "@supabase/supabase-js";
import { assembleCompanyContext, companyContextToMarkdown } from "@/lib/company-context";

function baselineMission(project: { name: string; domain: string | null; idea_description: string }) {
  return [
    `# Mission - ${project.name}`,
    "",
    "## Purpose",
    project.idea_description?.trim() || `Build and grow ${project.name}.`,
    "",
    "## Strategic North Star",
    "Ship high-leverage improvements that increase customer value and sustainable revenue.",
    "",
    "## Ideal Customer Profile",
    project.domain ? `Users interested in offerings related to ${project.domain}.` : "To be refined from market signal.",
  ].join("\n");
}

const BASELINE_MEMORY = [
  "# Operating Memory",
  "",
  "Company created. Waiting for first user and system events.",
].join("\n");

export async function ensureProjectBrainDocument(db: SupabaseClient, projectId: string) {
  const existing = await db
    .from("project_brain_documents")
    .select("project_id")
    .eq("project_id", projectId)
    .maybeSingle();

  if (existing.data) return;

  const project = await db
    .from("projects")
    .select("name,domain,idea_description")
    .eq("id", projectId)
    .single();

  if (!project.data) return;

  const mission = baselineMission({
    name: String(project.data.name ?? "Company"),
    domain: (project.data.domain as string | null) ?? null,
    idea_description: String(project.data.idea_description ?? ""),
  });

  await db.from("project_brain_documents").upsert(
    {
      project_id: projectId,
      mission_markdown: mission,
      memory_markdown: BASELINE_MEMORY,
      memory_version: 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id" },
  );
}

function shortSummaryLines(markdown: string, maxLines = 20) {
  return markdown
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(0, maxLines)
    .join("\n");
}

export async function refreshCompanyBrain(input: {
  db: SupabaseClient;
  projectId: string;
  triggerEventId?: string | null;
  reason?: "event_ingest" | "scheduled_refresh" | "manual";
  writeMemoryAsset?: boolean;
}) {
  const db = input.db;
  const nowIso = new Date().toISOString();

  await ensureProjectBrainDocument(db, input.projectId);

  const { data: updateRow } = await db
    .from("project_brain_updates")
    .insert({
      project_id: input.projectId,
      status: "running",
      trigger_event_id: input.triggerEventId ?? null,
      reason: input.reason ?? "event_ingest",
      created_at: nowIso,
      started_at: nowIso,
    })
    .select("id")
    .single();

  const updateId = (updateRow?.id as string | undefined) ?? null;

  try {
    const context = await assembleCompanyContext(db, input.projectId);
    const nextMemory = companyContextToMarkdown(context);

    const currentBrain = await db
      .from("project_brain_documents")
      .select("memory_version,last_event_id,mission_markdown")
      .eq("project_id", input.projectId)
      .single();

    const nextVersion = Number(currentBrain.data?.memory_version ?? 0) + 1;
    const newestEventId = context.delta_events[0]?.id ?? currentBrain.data?.last_event_id ?? null;

    await db
      .from("project_brain_documents")
      .update({
        mission_markdown: currentBrain.data?.mission_markdown ?? context.mission_markdown,
        memory_markdown: nextMemory,
        memory_version: nextVersion,
        last_event_id: newestEventId,
        updated_at: new Date().toISOString(),
      })
      .eq("project_id", input.projectId);

    if (input.writeMemoryAsset) {
      const memoryAsset = [
        `# Company Memory Snapshot`,
        ``,
        `- project_id: ${input.projectId}`,
        `- updated_at: ${new Date().toISOString()}`,
        `- memory_version: ${nextVersion}`,
        ``,
        shortSummaryLines(nextMemory, 220),
        ``,
      ].join("\n");

      const storagePath = `${input.projectId}/brain/memory-latest.md`;
      await db.storage.from("project-assets").upload(storagePath, Buffer.from(memoryAsset, "utf8"), {
        contentType: "text/markdown; charset=utf-8",
        upsert: true,
      });

      await db.from("project_assets").upsert(
        {
          project_id: input.projectId,
          kind: "upload",
          storage_bucket: "project-assets",
          storage_path: storagePath,
          filename: "memory.md",
          mime_type: "text/markdown",
          size_bytes: Buffer.byteLength(memoryAsset, "utf8"),
          status: "uploaded",
          metadata: {
            generated_by: "brain.refresh",
            memory_version: nextVersion,
          },
          created_by: null,
        },
        { onConflict: "project_id,storage_path" },
      );
    }

    if (updateId) {
      await db
        .from("project_brain_updates")
        .update({
          status: "completed",
          input_event_count: context.delta_events.length,
          completed_at: new Date().toISOString(),
        })
        .eq("id", updateId);
    }

    return {
      memoryVersion: nextVersion,
      deltaEvents: context.delta_events.length,
      mission: context.mission_markdown,
      memory: nextMemory,
    };
  } catch (error) {
    if (updateId) {
      await db
        .from("project_brain_updates")
        .update({
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown refresh error",
          completed_at: new Date().toISOString(),
        })
        .eq("id", updateId);
    }
    throw error;
  }
}
