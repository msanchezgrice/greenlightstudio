import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";

export type ProjectSummary = {
  id: string;
  name: string;
  phase: number;
  domain: string | null;
  repo_url: string | null;
  runtime_mode: "shared" | "attached";
  permissions: {
    repo_write?: boolean;
    deploy?: boolean;
    ads_enabled?: boolean;
    ads_budget_cap?: number;
    email_send?: boolean;
  } | null;
  night_shift: boolean;
  focus_areas: string[] | null;
  created_at: string;
  updated_at: string;
};

export type PacketSummary = {
  project_id: string;
  phase: number;
  confidence: number;
  created_at: string;
};

export type TaskSummary = {
  project_id: string;
  agent: string;
  description: string;
  status: "queued" | "running" | "completed" | "failed";
  detail: string | null;
  created_at: string;
};

export async function getOwnedProjects(userId: string) {
  const db = createServiceSupabase();
  const { data, error } = await withRetry(() =>
    db
      .from("projects")
      .select("id,name,phase,domain,repo_url,runtime_mode,permissions,night_shift,focus_areas,created_at,updated_at")
      .eq("owner_clerk_id", userId)
      .order("created_at", { ascending: false }),
  );

  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectSummary[];
}

export async function getPendingApprovalsByProject(projectIds: string[]) {
  if (!projectIds.length) return { total: 0, byProject: new Map<string, number>() };

  const db = createServiceSupabase();
  const { data, error } = await withRetry(() =>
    db.from("approval_queue").select("project_id").in("project_id", projectIds).eq("status", "pending"),
  );

  if (error) throw new Error(error.message);

  const byProject = new Map<string, number>();
  for (const row of data ?? []) {
    const projectId = row.project_id as string;
    byProject.set(projectId, (byProject.get(projectId) ?? 0) + 1);
  }

  return {
    total: (data ?? []).length,
    byProject,
  };
}

export async function getLatestPacketsByProject(projectIds: string[]) {
  if (!projectIds.length) return new Map<string, PacketSummary>();

  const db = createServiceSupabase();
  const { data, error } = await withRetry(() =>
    db
      .from("phase_packets")
      .select("project_id,phase,confidence,created_at")
      .in("project_id", projectIds)
      .order("created_at", { ascending: false })
      .limit(500),
  );

  if (error) throw new Error(error.message);

  const latest = new Map<string, PacketSummary>();
  for (const row of data ?? []) {
    const projectId = row.project_id as string;
    if (latest.has(projectId)) continue;

    latest.set(projectId, {
      project_id: projectId,
      phase: row.phase as number,
      confidence: row.confidence as number,
      created_at: row.created_at as string,
    });
  }

  return latest;
}

export async function getLatestTasksByProject(projectIds: string[]) {
  if (!projectIds.length) return new Map<string, TaskSummary>();

  const db = createServiceSupabase();
  const { data, error } = await withRetry(() =>
    db
      .from("tasks")
      .select("project_id,agent,description,status,detail,created_at")
      .in("project_id", projectIds)
      .order("created_at", { ascending: false })
      .limit(500),
  );

  if (error) throw new Error(error.message);

  const latest = new Map<string, TaskSummary>();
  for (const row of data ?? []) {
    const projectId = row.project_id as string;
    if (latest.has(projectId)) continue;

    latest.set(projectId, {
      project_id: projectId,
      agent: row.agent as string,
      description: row.description as string,
      status: row.status as TaskSummary["status"],
      detail: (row.detail as string | null) ?? null,
      created_at: row.created_at as string,
    });
  }

  return latest;
}
