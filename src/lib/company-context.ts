import type { SupabaseClient } from "@supabase/supabase-js";

export type CompanyKpiSnapshot = {
  traffic_7d: number;
  traffic_30d: number;
  leads_7d: number;
  leads_30d: number;
  conversion_proxy_7d: number;
  conversion_proxy_30d: number;
  payments_succeeded_7d: number;
  payments_succeeded_30d: number;
  revenue_cents_7d: number;
  revenue_cents_30d: number;
};

export type CompanyContext = {
  project: {
    id: string;
    name: string;
    domain: string | null;
    phase: number;
    runtime_mode: string;
  };
  mission_markdown: string;
  memory_markdown: string;
  delta_events: Array<{
    id: string;
    event_type: string;
    message: string | null;
    data: Record<string, unknown>;
    created_at: string;
  }>;
  latest_packet: {
    phase: number;
    confidence: number;
    recommendation: string | null;
    summary: string | null;
  } | null;
  approvals: Array<{ title: string; status: string; risk: string; created_at: string }>;
  tasks: Array<{ agent: string; description: string; status: string; detail: string | null; created_at: string }>;
  executions: Array<{ action_type: string; status: string; detail: string | null; created_at: string }>;
  assets: Array<{ kind: string; filename: string; status: string; created_at: string }>;
  emails: {
    inbound: Array<{ from_email: string; subject: string | null; created_at: string }>;
    outbound: Array<{ to_email: string; subject: string; status: string; created_at: string }>;
  };
  kpis: CompanyKpiSnapshot;
  memory_entries: Array<{ category: string; key: string; value: string; updated_at: string }>;
};

const DEFAULT_MISSION = [
  "# Company Mission",
  "",
  "Define a clear purpose, ideal customer profile, and strategic north star for this company.",
].join("\n");

const DEFAULT_MEMORY = [
  "# Operating Memory",
  "",
  "No major activity recorded yet. This document will auto-refresh from chat, email, tasks, approvals, deploys, and KPI events.",
].join("\n");

function safeJson(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

async function kpiSnapshot(db: SupabaseClient, projectId: string): Promise<CompanyKpiSnapshot> {
  const now = Date.now();
  const d7 = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const d30 = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [traffic7, traffic30, leads7, leads30, payments7, payments30, revenue7, revenue30] = await Promise.all([
    db
      .from("project_analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("event_name", "traffic")
      .gte("occurred_at", d7),
    db
      .from("project_analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("event_name", "traffic")
      .gte("occurred_at", d30),
    db
      .from("project_analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .in("event_name", ["lead", "signup", "waitlist_submit"])
      .gte("occurred_at", d7),
    db
      .from("project_analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .in("event_name", ["lead", "signup", "waitlist_submit"])
      .gte("occurred_at", d30),
    db
      .from("project_payment_events")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "succeeded")
      .gte("occurred_at", d7),
    db
      .from("project_payment_events")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "succeeded")
      .gte("occurred_at", d30),
    db
      .from("project_payment_events")
      .select("amount_cents")
      .eq("project_id", projectId)
      .eq("status", "succeeded")
      .gte("occurred_at", d7),
    db
      .from("project_payment_events")
      .select("amount_cents")
      .eq("project_id", projectId)
      .eq("status", "succeeded")
      .gte("occurred_at", d30),
  ]);

  const traffic7Count = traffic7.count ?? 0;
  const traffic30Count = traffic30.count ?? 0;
  const leads7Count = leads7.count ?? 0;
  const leads30Count = leads30.count ?? 0;
  const payments7Count = payments7.count ?? 0;
  const payments30Count = payments30.count ?? 0;
  const revenue7Cents = (revenue7.data ?? []).reduce((sum, row) => sum + Number(row.amount_cents ?? 0), 0);
  const revenue30Cents = (revenue30.data ?? []).reduce((sum, row) => sum + Number(row.amount_cents ?? 0), 0);

  return {
    traffic_7d: traffic7Count,
    traffic_30d: traffic30Count,
    leads_7d: leads7Count,
    leads_30d: leads30Count,
    conversion_proxy_7d: traffic7Count > 0 ? Number((leads7Count / traffic7Count).toFixed(4)) : 0,
    conversion_proxy_30d: traffic30Count > 0 ? Number((leads30Count / traffic30Count).toFixed(4)) : 0,
    payments_succeeded_7d: payments7Count,
    payments_succeeded_30d: payments30Count,
    revenue_cents_7d: revenue7Cents,
    revenue_cents_30d: revenue30Cents,
  };
}

function compressJson(value: Record<string, unknown>) {
  const str = JSON.stringify(value);
  if (str.length <= 180) return str;
  return `${str.slice(0, 177)}...`;
}

export function companyContextToMarkdown(context: CompanyContext) {
  const eventLines = context.delta_events
    .slice(0, 20)
    .map((event) => `- [${event.event_type}] ${event.message ?? "(no message)"} ${Object.keys(event.data).length ? compressJson(event.data) : ""}`)
    .join("\n");

  const taskLines = context.tasks
    .slice(0, 10)
    .map((task) => `- ${task.agent} | ${task.description} | ${task.status}${task.detail ? ` | ${task.detail}` : ""}`)
    .join("\n");

  const approvalLines = context.approvals
    .slice(0, 8)
    .map((approval) => `- ${approval.title} | ${approval.status} | ${approval.risk}`)
    .join("\n");

  const inboundLines = context.emails.inbound
    .slice(0, 8)
    .map((email) => `- ${email.from_email}: ${email.subject ?? "(no subject)"}`)
    .join("\n");

  const outboundLines = context.emails.outbound
    .slice(0, 8)
    .map((email) => `- ${email.to_email}: ${email.subject} [${email.status}]`)
    .join("\n");

  const memoryLines = context.memory_entries
    .slice(0, 12)
    .map((row) => `- ${row.category}.${row.key}: ${row.value}`)
    .join("\n");

  return [
    "## Mission",
    context.mission_markdown,
    "",
    "## Memory",
    context.memory_markdown,
    "",
    "## Recent Delta Events",
    eventLines || "- none",
    "",
    "## Current Operational Snapshot",
    `- phase: ${context.project.phase}`,
    `- packet: ${context.latest_packet ? `phase ${context.latest_packet.phase} | confidence ${context.latest_packet.confidence}` : "none"}`,
    "",
    "### Approvals",
    approvalLines || "- none",
    "",
    "### Tasks",
    taskLines || "- none",
    "",
    "### Inbound Email",
    inboundLines || "- none",
    "",
    "### Outbound Email",
    outboundLines || "- none",
    "",
    "### KPIs",
    `- traffic_7d: ${context.kpis.traffic_7d}`,
    `- traffic_30d: ${context.kpis.traffic_30d}`,
    `- leads_7d: ${context.kpis.leads_7d}`,
    `- leads_30d: ${context.kpis.leads_30d}`,
    `- conversion_proxy_7d: ${context.kpis.conversion_proxy_7d}`,
    `- conversion_proxy_30d: ${context.kpis.conversion_proxy_30d}`,
    `- payments_succeeded_7d: ${context.kpis.payments_succeeded_7d}`,
    `- payments_succeeded_30d: ${context.kpis.payments_succeeded_30d}`,
    `- revenue_cents_7d: ${context.kpis.revenue_cents_7d}`,
    `- revenue_cents_30d: ${context.kpis.revenue_cents_30d}`,
    "",
    "### Long-Term Memory Entries",
    memoryLines || "- none",
  ].join("\n");
}

export async function assembleCompanyContext(db: SupabaseClient, projectId: string): Promise<CompanyContext> {
  const [projectRes, brainRes, packetRes, approvalsRes, tasksRes, executionsRes, assetsRes, inboundRes, outboundRes, memoryRes] =
    await Promise.all([
      db
        .from("projects")
        .select("id,name,domain,phase,runtime_mode")
        .eq("id", projectId)
        .single(),
      db
        .from("project_brain_documents")
        .select("mission_markdown,memory_markdown,last_event_id")
        .eq("project_id", projectId)
        .maybeSingle(),
      db
        .from("phase_packets")
        .select("phase,confidence,ceo_recommendation,reasoning_synopsis")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("approval_queue")
        .select("title,status,risk,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(12),
      db
        .from("tasks")
        .select("agent,description,status,detail,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(20),
      db
        .from("action_executions")
        .select("action_type,status,detail,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(12),
      db
        .from("project_assets")
        .select("kind,filename,status,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(20),
      db
        .from("inbound_email_messages")
        .select("from_email,subject,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(12),
      db
        .from("email_jobs")
        .select("to_email,subject,status,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(12),
      db
        .from("agent_memory")
        .select("category,key,value,updated_at")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false })
        .limit(40),
    ]);

  if (projectRes.error || !projectRes.data) {
    throw new Error(projectRes.error?.message ?? "Project not found while assembling company context");
  }

  let deltaEventsQuery = db
    .from("project_events")
    .select("id,event_type,message,data,created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (brainRes.data?.last_event_id) {
    const cursor = await db
      .from("project_events")
      .select("created_at")
      .eq("id", brainRes.data.last_event_id)
      .maybeSingle();
    if (cursor.data?.created_at) {
      deltaEventsQuery = deltaEventsQuery.gt("created_at", cursor.data.created_at);
    }
  }

  const deltaEventsRes = await deltaEventsQuery;
  const kpis = await kpiSnapshot(db, projectId);

  const reasoningSynopsis = safeJson(packetRes.data?.reasoning_synopsis ?? {});
  const rationaleList = Array.isArray(reasoningSynopsis.rationale)
    ? reasoningSynopsis.rationale.filter((entry): entry is string => typeof entry === "string")
    : [];

  return {
    project: {
      id: String(projectRes.data.id),
      name: String(projectRes.data.name),
      domain: (projectRes.data.domain as string | null) ?? null,
      phase: Number(projectRes.data.phase ?? 0),
      runtime_mode: String(projectRes.data.runtime_mode ?? "shared"),
    },
    mission_markdown: brainRes.data?.mission_markdown ?? DEFAULT_MISSION,
    memory_markdown: brainRes.data?.memory_markdown ?? DEFAULT_MEMORY,
    delta_events: ((deltaEventsRes.data ?? []) as Array<Record<string, unknown>>).map((event) => ({
      id: String(event.id),
      event_type: String(event.event_type),
      message: (event.message as string | null) ?? null,
      data: safeJson(event.data),
      created_at: String(event.created_at),
    })),
    latest_packet: packetRes.data
      ? {
          phase: Number(packetRes.data.phase),
          confidence: Number(packetRes.data.confidence ?? 0),
          recommendation: (packetRes.data.ceo_recommendation as string | null) ?? null,
          summary: rationaleList.length ? rationaleList[0] : null,
        }
      : null,
    approvals: ((approvalsRes.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      title: String(row.title ?? "Untitled approval"),
      status: String(row.status ?? "unknown"),
      risk: String(row.risk ?? "unknown"),
      created_at: String(row.created_at ?? new Date().toISOString()),
    })),
    tasks: ((tasksRes.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      agent: String(row.agent ?? "unknown"),
      description: String(row.description ?? "unknown"),
      status: String(row.status ?? "unknown"),
      detail: (row.detail as string | null) ?? null,
      created_at: String(row.created_at ?? new Date().toISOString()),
    })),
    executions: ((executionsRes.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      action_type: String(row.action_type ?? "unknown"),
      status: String(row.status ?? "unknown"),
      detail: (row.detail as string | null) ?? null,
      created_at: String(row.created_at ?? new Date().toISOString()),
    })),
    assets: ((assetsRes.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      kind: String(row.kind ?? "unknown"),
      filename: String(row.filename ?? "unknown"),
      status: String(row.status ?? "unknown"),
      created_at: String(row.created_at ?? new Date().toISOString()),
    })),
    emails: {
      inbound: ((inboundRes.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        from_email: String(row.from_email ?? "unknown"),
        subject: (row.subject as string | null) ?? null,
        created_at: String(row.created_at ?? new Date().toISOString()),
      })),
      outbound: ((outboundRes.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        to_email: String(row.to_email ?? "unknown"),
        subject: String(row.subject ?? "(no subject)"),
        status: String(row.status ?? "unknown"),
        created_at: String(row.created_at ?? new Date().toISOString()),
      })),
    },
    kpis,
    memory_entries: ((memoryRes.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      category: String(row.category ?? "context"),
      key: String(row.key ?? "unknown"),
      value: String(row.value ?? ""),
      updated_at: String(row.updated_at ?? new Date().toISOString()),
    })),
  };
}
