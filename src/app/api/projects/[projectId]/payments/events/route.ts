import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { recordProjectEvent } from "@/lib/project-events";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { JOB_TYPES, AGENT_KEYS, PRIORITY } from "@/lib/jobs/constants";

const paymentEventSchema = z.object({
  provider: z.string().trim().min(1).max(80),
  external_id: z.string().trim().max(200).optional().nullable(),
  event_type: z.string().trim().min(1).max(120),
  status: z.string().trim().min(1).max(80),
  amount_cents: z.number().int().min(0).optional().default(0),
  currency: z.string().trim().max(12).optional().default("USD"),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  occurred_at: z.string().datetime().optional(),
});

const bodySchema = z.object({
  events: z.array(paymentEventSchema).min(1).max(100),
});

function shouldTriggerProvisioning(eventType: string, status: string) {
  const normalizedType = eventType.toLowerCase();
  const normalizedStatus = status.toLowerCase();
  return (
    normalizedType === "subscription_active" ||
    normalizedType === "subscription.activated" ||
    (normalizedType === "subscription_updated" && normalizedStatus === "active")
  );
}

export async function POST(req: Request, context: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await context.params;
  const db = createServiceSupabase();

  const { data: project } = await db
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("owner_clerk_id", userId)
    .maybeSingle();

  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const body = bodySchema.parse(await req.json());

  const rows = body.events.map((event) => ({
    project_id: projectId,
    provider: event.provider,
    external_id: event.external_id ?? null,
    event_type: event.event_type,
    status: event.status,
    amount_cents: event.amount_cents,
    currency: event.currency,
    metadata: event.metadata,
    occurred_at: event.occurred_at ?? new Date().toISOString(),
  }));

  const { error } = await db.from("project_payment_events").insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await recordProjectEvent(db, {
    projectId,
    eventType: "payments.ingested",
    message: `Ingested ${rows.length} payment events`,
    data: {
      count: rows.length,
      statuses: Array.from(new Set(rows.map((row) => row.status))).slice(0, 10),
      providers: Array.from(new Set(rows.map((row) => row.provider))).slice(0, 10),
    },
    agentKey: "system",
  });

  const activationEvent = rows.find((row) => shouldTriggerProvisioning(row.event_type, row.status));
  let provisioningJobId: string | null = null;

  if (activationEvent) {
    try {
      provisioningJobId = await enqueueJob({
        projectId,
        jobType: JOB_TYPES.RUNTIME_PROVISION,
        agentKey: AGENT_KEYS.PROVISIONER,
        payload: {
          projectId,
          provider: "render",
          activation_event_type: activationEvent.event_type,
          activation_status: activationEvent.status,
          activation_external_id: activationEvent.external_id,
        },
        idempotencyKey: `runtime-provision:${projectId}:${activationEvent.event_type}:${activationEvent.external_id ?? "none"}`,
        priority: PRIORITY.USER_BLOCKING,
      });

      await recordProjectEvent(db, {
        projectId,
        eventType: "runtime.provisioning_requested",
        message: "Payment activation triggered dedicated runtime provisioning",
        data: {
          activation_event_type: activationEvent.event_type,
          activation_status: activationEvent.status,
          provisioning_job_id: provisioningJobId,
        },
        agentKey: "provisioner",
      });
    } catch {
      // Non-fatal: payment ingestion should still succeed.
    }
  }

  return NextResponse.json({
    ok: true,
    inserted: rows.length,
    provisioningJobId,
  });
}
