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
  live_url: string | null;
  deploy_status: string | null;
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
      .select("id,name,phase,domain,repo_url,runtime_mode,permissions,night_shift,focus_areas,live_url,deploy_status,created_at,updated_at")
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

export async function getRecentActivity(userId: string, limit = 8) {
  const db = createServiceSupabase();
  const { data: projects } = await withRetry(() =>
    db.from("projects").select("id,name").eq("owner_clerk_id", userId),
  );
  if (!projects?.length) return [];
  const projectIds = projects.map((p) => p.id);
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const { data, error } = await withRetry(() =>
    db
      .from("tasks")
      .select("project_id,agent,description,status,detail,created_at")
      .in("project_id", projectIds)
      .order("created_at", { ascending: false })
      .limit(limit),
  );
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    project_name: projectNames.get(row.project_id as string) ?? "Unknown",
    project_id: row.project_id as string,
    agent: row.agent as string,
    description: row.description as string,
    status: row.status as string,
    detail: (row.detail as string | null) ?? null,
    created_at: row.created_at as string,
  }));
}

export async function getPacketCount(projectIds: string[]) {
  if (!projectIds.length) return 0;
  const db = createServiceSupabase();
  const { count, error } = await withRetry(() =>
    db.from("phase_packets").select("id", { count: "exact", head: true }).in("project_id", projectIds),
  );
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function getRunningTasks(projectIds: string[]) {
  if (!projectIds.length) return new Map<string, { agent: string; description: string }>();
  const db = createServiceSupabase();
  const { data, error } = await withRetry(() =>
    db
      .from("tasks")
      .select("project_id,agent,description")
      .in("project_id", projectIds)
      .eq("status", "running")
      .order("created_at", { ascending: false })
      .limit(100),
  );
  if (error) throw new Error(error.message);
  const running = new Map<string, { agent: string; description: string }>();
  for (const row of data ?? []) {
    const pid = row.project_id as string;
    if (!running.has(pid)) {
      running.set(pid, { agent: row.agent as string, description: row.description as string });
    }
  }
  return running;
}

export type ProjectPacketRow = {
  id: string;
  phase: number;
  confidence: number;
  created_at: string;
};

export async function getPacketsByProject(projectId: string) {
  const db = createServiceSupabase();
  const { data, error } = await withRetry(() =>
    db
      .from("phase_packets")
      .select("id,phase,confidence,created_at")
      .eq("project_id", projectId)
      .order("phase", { ascending: true }),
  );
  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectPacketRow[];
}

export type ProjectAssetRow = {
  id: string;
  phase: number | null;
  kind: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  status: "pending" | "uploaded" | "failed";
  storage_path: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function getProjectAssets(projectId: string) {
  const db = createServiceSupabase();
  const { data, error } = await withRetry(() =>
    db
      .from("project_assets")
      .select("id,phase,kind,filename,mime_type,size_bytes,status,storage_path,metadata,created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(50),
  );
  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectAssetRow[];
}

const MILESTONE_DESCRIPTIONS = new Set([
  "phase0_packet", "phase0_complete",
  "phase1_landing_deploy", "phase1_brand_assets", "phase1_complete",
  "phase2_distribute", "phase2_email", "phase2_ads",
  "phase3_deploy", "phase3_golive",
  "nightshift_summary",
]);

export async function getRecentMilestones(userId: string, limit = 6) {
  const db = createServiceSupabase();
  const { data: projects } = await withRetry(() =>
    db.from("projects").select("id,name").eq("owner_clerk_id", userId),
  );
  if (!projects?.length) return [];
  const projectIds = projects.map((p) => p.id);
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const { data, error } = await withRetry(() =>
    db
      .from("tasks")
      .select("project_id,agent,description,status,detail,created_at")
      .in("project_id", projectIds)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(100),
  );
  if (error) throw new Error(error.message);
  const milestones = (data ?? [])
    .filter((row) => MILESTONE_DESCRIPTIONS.has(row.description as string))
    .slice(0, limit);
  return milestones.map((row) => ({
    project_name: projectNames.get(row.project_id as string) ?? "Unknown",
    project_id: row.project_id as string,
    agent: row.agent as string,
    description: row.description as string,
    status: row.status as string,
    detail: (row.detail as string | null) ?? null,
    created_at: row.created_at as string,
  }));
}

export async function getAllRunningTasks(projectIds: string[]) {
  if (!projectIds.length) return [];
  const db = createServiceSupabase();
  const { data, error } = await withRetry(() =>
    db
      .from("tasks")
      .select("project_id,agent,description,detail")
      .in("project_id", projectIds)
      .eq("status", "running")
      .order("created_at", { ascending: false })
      .limit(20),
  );
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    project_id: row.project_id as string,
    agent: row.agent as string,
    description: row.description as string,
    detail: (row.detail as string | null) ?? null,
  }));
}

const STALE_TASK_THRESHOLD_MIN = 45;

export async function cleanupStaleTasks(projectIds: string[]) {
  if (!projectIds.length) return 0;
  const db = createServiceSupabase();
  const { data: runningJobs, error: runningJobsError } = await withRetry(() =>
    db
      .from("agent_jobs")
      .select("project_id")
      .in("project_id", projectIds)
      .eq("status", "running"),
  );
  if (runningJobsError) return 0;

  const runningProjectIds = new Set((runningJobs ?? []).map((row) => String(row.project_id)));
  const orphanCandidateProjectIds = projectIds.filter((projectId) => !runningProjectIds.has(projectId));
  if (!orphanCandidateProjectIds.length) return 0;

  const cutoff = new Date(Date.now() - STALE_TASK_THRESHOLD_MIN * 60 * 1000).toISOString();
  const completedAt = new Date().toISOString();
  const { data, error } = await db
    .from("tasks")
    .update({ status: "failed", detail: "Timed out (stale task cleanup)", completed_at: completedAt })
    .in("project_id", orphanCandidateProjectIds)
    .eq("status", "running")
    .lt("created_at", cutoff)
    .select("id");
  if (error) return 0;
  return data?.length ?? 0;
}
