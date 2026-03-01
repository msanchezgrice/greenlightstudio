import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { recordProjectEvent } from "@/lib/project-events";

const eventSchema = z.object({
  source: z.string().trim().max(80).optional().default("manual"),
  event_type: z.string().trim().max(80).optional().default("track"),
  event_name: z.string().trim().min(1).max(120),
  value_numeric: z.number().optional().nullable(),
  value_text: z.string().max(500).optional().nullable(),
  currency: z.string().trim().max(12).optional().nullable(),
  properties: z.record(z.string(), z.unknown()).optional().default({}),
  occurred_at: z.string().datetime().optional(),
});

const bodySchema = z.object({
  events: z.array(eventSchema).min(1).max(200),
});

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
    source: event.source,
    event_type: event.event_type,
    event_name: event.event_name,
    value_numeric: event.value_numeric ?? null,
    value_text: event.value_text ?? null,
    currency: event.currency ?? null,
    properties: event.properties,
    occurred_at: event.occurred_at ?? new Date().toISOString(),
  }));

  const { error } = await db.from("project_analytics_events").insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await recordProjectEvent(db, {
    projectId,
    eventType: "analytics.ingested",
    message: `Ingested ${rows.length} analytics events`,
    data: {
      count: rows.length,
      sources: Array.from(new Set(rows.map((row) => row.source))).slice(0, 8),
      names: Array.from(new Set(rows.map((row) => row.event_name))).slice(0, 12),
    },
    agentKey: "system",
  });

  return NextResponse.json({ ok: true, inserted: rows.length });
}
