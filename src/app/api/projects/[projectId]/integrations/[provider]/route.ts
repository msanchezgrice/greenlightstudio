import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { upsertProjectIntegration } from "@/lib/project-integrations";
import { recordProjectEvent } from "@/lib/project-events";

const providerSchema = z.enum(["resend", "meta", "github", "vercel", "analytics", "payments"]);

const bodySchema = z.object({
  enabled: z.boolean().optional().default(true),
  config: z.record(z.string(), z.unknown()),
});

async function ensureOwnedProject(db: ReturnType<typeof createServiceSupabase>, projectId: string, userId: string) {
  const { data } = await db
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("owner_clerk_id", userId)
    .maybeSingle();
  return data;
}

export async function GET(_: Request, context: { params: Promise<{ projectId: string; provider: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId, provider } = await context.params;
  const parsedProvider = providerSchema.safeParse(provider);
  if (!parsedProvider.success) return NextResponse.json({ error: "Unsupported provider" }, { status: 400 });

  const db = createServiceSupabase();
  const project = await ensureOwnedProject(db, projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const { data, error } = await db
    .from("project_integrations")
    .select("provider,enabled,config_masked,updated_at")
    .eq("project_id", projectId)
    .eq("provider", parsedProvider.data)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ provider: parsedProvider.data, configured: false });

  return NextResponse.json({
    provider: data.provider,
    configured: true,
    enabled: data.enabled,
    config_masked: data.config_masked,
    updated_at: data.updated_at,
  });
}

export async function PUT(req: Request, context: { params: Promise<{ projectId: string; provider: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId, provider } = await context.params;
  const parsedProvider = providerSchema.safeParse(provider);
  if (!parsedProvider.success) return NextResponse.json({ error: "Unsupported provider" }, { status: 400 });

  const db = createServiceSupabase();
  const project = await ensureOwnedProject(db, projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const body = bodySchema.parse(await req.json());

  await upsertProjectIntegration({
    projectId,
    provider: parsedProvider.data,
    config: body.config,
    enabled: body.enabled,
  });

  const { data } = await db
    .from("project_integrations")
    .select("provider,enabled,config_masked,updated_at")
    .eq("project_id", projectId)
    .eq("provider", parsedProvider.data)
    .single();

  if (!data) {
    return NextResponse.json({ error: "Integration save failed" }, { status: 500 });
  }

  await recordProjectEvent(db, {
    projectId,
    eventType: "integration.updated",
    message: `Integration updated: ${parsedProvider.data}`,
    data: {
      provider: parsedProvider.data,
      enabled: body.enabled,
      updated_by: userId,
    },
    agentKey: "system",
  });

  return NextResponse.json({
    ok: true,
    provider: data.provider,
    enabled: data.enabled,
    config_masked: data.config_masked,
    updated_at: data.updated_at,
  });
}
