import type { SupabaseClient } from "@supabase/supabase-js";

export type MemoryCategory =
  | "fact"
  | "preference"
  | "decision"
  | "learning"
  | "context";

export type MemoryEntry = {
  category: MemoryCategory;
  key: string;
  value: string;
  agentKey: string;
  confidence?: number;
};

type MemoryRow = {
  id: string;
  category: string;
  key: string;
  value: string;
  agent_key: string;
  confidence: number;
  updated_at: string;
};

export async function loadMemory(
  db: SupabaseClient,
  projectId: string,
  categories?: MemoryCategory[]
): Promise<MemoryRow[]> {
  let query = db
    .from("agent_memory")
    .select("id,category,key,value,agent_key,confidence,updated_at")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (categories?.length) {
    query = query.in("category", categories);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[memory] load error:", error.message);
    return [];
  }
  return (data ?? []) as MemoryRow[];
}

export async function writeMemory(
  db: SupabaseClient,
  projectId: string,
  jobId: string | null,
  entries: MemoryEntry[]
): Promise<void> {
  if (!entries.length) return;

  const rows = entries.map((e) => ({
    project_id: projectId,
    category: e.category,
    key: e.key,
    value: e.value,
    agent_key: e.agentKey,
    confidence: e.confidence ?? 1.0,
    source_job_id: jobId,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await db
    .from("agent_memory")
    .upsert(rows, { onConflict: "project_id,category,key" });

  if (error) {
    console.error("[memory] write error:", error.message);
  }
}

export function formatMemoryForPrompt(memories: MemoryRow[]): string {
  if (!memories.length) return "";

  const grouped: Record<string, string[]> = {};
  for (const m of memories) {
    const cat = m.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(`- ${m.key}: ${m.value}`);
  }

  const sections = Object.entries(grouped)
    .map(([cat, items]) => `### ${cat}\n${items.join("\n")}`)
    .join("\n\n");

  return `## Project Memory (accumulated knowledge from prior runs)\n\n${sections}`;
}
