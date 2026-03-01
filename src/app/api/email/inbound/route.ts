import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { getProjectByReplyAddress } from "@/lib/project-integrations";
import { recordProjectEvent } from "@/lib/project-events";

const inboundSchema = z.object({
  provider: z.string().trim().min(1).max(80),
  message_id: z.string().trim().max(255).optional().nullable(),
  from: z.string().trim().email(),
  to: z.string().trim().email(),
  subject: z.string().trim().max(500).optional().nullable(),
  text: z.string().optional().nullable(),
  html: z.string().optional().nullable(),
  payload: z.record(z.string(), z.unknown()).optional(),
  mirror_to_chat: z.boolean().optional().default(true),
});

function isAuthorized(req: Request) {
  const secret = process.env.INBOUND_EMAIL_SECRET?.trim();
  if (!secret) return false;

  const headerSecret = req.headers.get("x-inbound-email-secret")?.trim();
  const authBearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();

  return headerSecret === secret || authBearer === secret;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceSupabase();

  let body: z.infer<typeof inboundSchema>;
  try {
    body = inboundSchema.parse(await req.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid payload";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const identity = await getProjectByReplyAddress(body.to.toLowerCase());
  if (!identity) {
    return NextResponse.json({ error: "No matching project for reply address" }, { status: 404 });
  }

  const { data: project } = await db
    .from("projects")
    .select("id,owner_clerk_id")
    .eq("id", identity.project_id)
    .single();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const insert = await db
    .from("inbound_email_messages")
    .insert({
      project_id: identity.project_id,
      email_identity_id: identity.id,
      provider: body.provider,
      provider_message_id: body.message_id ?? null,
      from_email: body.from.toLowerCase(),
      to_email: body.to.toLowerCase(),
      subject: body.subject ?? null,
      text_body: body.text ?? null,
      html_body: body.html ?? null,
      payload: body.payload ?? {},
      status: "processed",
      received_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insert.error) {
    if (insert.error.code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    return NextResponse.json({ error: insert.error.message }, { status: 400 });
  }

  if (body.mirror_to_chat) {
    const content = [
      `Inbound email from ${body.from}`,
      body.subject ? `Subject: ${body.subject}` : null,
      body.text ? body.text.slice(0, 3000) : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    await db.from("project_chat_messages").insert({
      project_id: identity.project_id,
      owner_clerk_id: project.owner_clerk_id,
      role: "system",
      content,
    });
  }

  await recordProjectEvent(db, {
    projectId: identity.project_id,
    eventType: "email.inbound.received",
    message: `Inbound email from ${body.from}`,
    data: {
      inbound_email_id: insert.data.id,
      provider: body.provider,
      from: body.from,
      to: body.to,
      subject: body.subject ?? null,
      mirrored_to_chat: body.mirror_to_chat,
    },
    agentKey: "system",
  });

  return NextResponse.json({ ok: true, inboundEmailId: insert.data.id });
}
