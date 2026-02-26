import type { Packet } from "@/types/domain";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { reasoningSynopsisSchema } from "@/types/domain";

type Permissions = {
  repo_write: boolean;
  deploy: boolean;
  ads_enabled?: boolean;
  ads_budget_cap: number;
  email_send: boolean;
};

type CreateProjectInput = {
  ownerClerkId: string;
  userId: string | null;
  name: string;
  domain: string | null;
  ideaDescription: string;
  repoUrl: string | null;
  runtimeMode: "shared" | "attached";
  permissions: Permissions;
  nightShift: boolean;
  focusAreas: string[];
  scanResults: Record<string, unknown> | null;
  wizardState: Record<string, unknown>;
};

export async function upsertUser(clerkId: string, email: string | null) {
  const db = createServiceSupabase();
  const { data, error } = await withRetry(() =>
    db
      .from("users")
      .upsert({ clerk_id: clerkId, email }, { onConflict: "clerk_id" })
      .select("id")
      .single(),
  );

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to upsert user");
  }

  return data.id as string;
}

export async function create_project(input: CreateProjectInput) {
  const db = createServiceSupabase();
  const { data, error } = await withRetry(() =>
    db
      .from("projects")
      .insert({
        owner_clerk_id: input.ownerClerkId,
        user_id: input.userId,
        name: input.name,
        domain: input.domain,
        idea_description: input.ideaDescription,
        repo_url: input.repoUrl,
        runtime_mode: input.runtimeMode,
        permissions: input.permissions,
        night_shift: input.nightShift,
        focus_areas: input.focusAreas,
        scan_results: input.scanResults,
        wizard_state: input.wizardState,
      })
      .select("id")
      .single(),
  );

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create project");
  }

  return data.id as string;
}

type PacketLike = Packet | (Record<string, unknown> & { reasoning_synopsis: unknown });

export async function save_packet(projectId: string, phase: number, packet: PacketLike) {
  const db = createServiceSupabase();
  const synopsis = reasoningSynopsisSchema.parse((packet as { reasoning_synopsis: unknown }).reasoning_synopsis);
  const confidence = synopsis.confidence;
  const recommendationRaw = (packet as { recommendation?: unknown }).recommendation;
  const recommendation = typeof recommendationRaw === "string" ? recommendationRaw : null;
  const { data, error } = await withRetry(() =>
    db
      .from("phase_packets")
      .upsert(
        {
          project_id: projectId,
          phase,
          packet,
          confidence,
          synopsis,
          packet_data: packet,
          confidence_score: confidence,
          ceo_recommendation: recommendation,
          reasoning_synopsis: synopsis,
        },
        { onConflict: "project_id,phase" },
      )
      .select("id")
      .single(),
  );

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to save packet");
  }

  return data.id as string;
}

export async function update_phase(projectId: string, phase: number) {
  const db = createServiceSupabase();
  const { error } = await withRetry(() => db.from("projects").update({ phase }).eq("id", projectId));
  if (error) throw new Error(error.message);
}

export async function get_approval_queue(projectIds: string[]) {
  const db = createServiceSupabase();
  const { data, error } = await withRetry(() =>
    db
      .from("approval_queue")
      .select("id,project_id,phase,title,description,risk,action_type,payload,status,version,created_at,decided_at")
      .in("project_id", projectIds)
      .order("created_at", { ascending: false }),
  );

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function log_task(projectId: string, agent: string, description: string, status: string, detail?: string) {
  const db = createServiceSupabase();
  const taskPayload = {
    project_id: projectId,
    agent,
    description,
    status,
    detail: detail ?? null,
  };

  const [{ error: taskError }, { error: logError }] = await withRetry(async () => {
    const taskResult = await db.from("tasks").insert(taskPayload);
    const logResult = await db.from("task_log").insert({ project_id: projectId, step: description, status, detail });
    return [taskResult, logResult] as const;
  });

  if (taskError) throw new Error(taskError.message);
  if (logError) throw new Error(logError.message);
}

export async function get_scan_cache(domain: string) {
  const db = createServiceSupabase();
  const normalized = domain.trim().toLowerCase();

  const { data, error } = await withRetry(() =>
    db
      .from("domain_scan_cache")
      .select("result, expires_at")
      .eq("domain", normalized)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle(),
  );

  if (error) throw new Error(error.message);
  return data?.result ?? null;
}

export async function set_scan_cache(domain: string, result: Record<string, unknown>) {
  const db = createServiceSupabase();
  const normalized = domain.trim().toLowerCase();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { error } = await withRetry(() =>
    db
      .from("domain_scan_cache")
      .upsert({ domain: normalized, result, expires_at: expiresAt, updated_at: new Date().toISOString() }, { onConflict: "domain" }),
  );

  if (error) throw new Error(error.message);
}
