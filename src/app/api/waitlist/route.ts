import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { parsePhasePacket, type Phase1Packet } from "@/types/phase-packets";

export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.object({
  project_id: z.string().uuid().optional(),
  email: z.string().email().max(254),
  source: z.string().min(1).max(64).optional(),
});

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function parseDayOffset(day: string) {
  const match = day.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function renderDripEmailHtml(input: { projectName: string; subject: string; goal: string; primary: string }) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b;">
<div style="max-width:560px;margin:0 auto;padding:40px 24px;">
<div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0;">
<div style="font-size:13px;font-weight:600;color:${escapeHtml(input.primary)};text-transform:uppercase;letter-spacing:0.05em;margin-bottom:12px;">${escapeHtml(input.projectName)}</div>
<h1 style="font-size:22px;margin:0 0 16px;color:#0f172a;">${escapeHtml(input.subject)}</h1>
<p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 24px;">${escapeHtml(input.goal)}</p>
<p style="font-size:13px;color:#94a3b8;margin:0;">You received this because you signed up for the ${escapeHtml(input.projectName)} waitlist.</p>
</div>
</div>
</body></html>`;
}

async function queueWaitlistDripEmails(projectId: string, email: string) {
  const db = createServiceSupabase();

  const { data: project } = await db
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .single();
  if (!project) return;

  const { data: packetRow } = await db
    .from("phase_packets")
    .select("packet")
    .eq("project_id", projectId)
    .eq("phase", 1)
    .maybeSingle();
  if (!packetRow) return;

  let packet: Phase1Packet;
  try {
    packet = parsePhasePacket(1, packetRow.packet) as Phase1Packet;
  } catch {
    return;
  }

  const primary = packet.brand_kit.color_palette[0] ?? "#6EE7B7";
  const now = Date.now();

  const rows = packet.email_sequence.emails.map((entry) => {
    const dayOffset = parseDayOffset(entry.day);
    return {
      project_id: projectId,
      to_email: email,
      subject: entry.subject,
      html_body: renderDripEmailHtml({ projectName: project.name as string, subject: entry.subject, goal: entry.goal, primary }),
      scheduled_for: new Date(now + dayOffset * 86400000).toISOString(),
      status: "queued",
    };
  });

  if (rows.length > 0) {
    await db.from("email_jobs").insert(rows);
  }
}

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    const email = normalizeEmail(body.email);
    const source = body.source?.trim() || "landing_page";
    const projectId = body.project_id;

    const db = createServiceSupabase();
    const { error } = await withRetry(() =>
      db.from("waitlist_signups").upsert(
        {
          email,
          source,
          metadata: {
            project_id: projectId ?? null,
            ip: req.headers.get("x-forwarded-for"),
            user_agent: req.headers.get("user-agent"),
            referer: req.headers.get("referer"),
          },
        },
        { onConflict: "email" },
      ),
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (projectId) {
      queueWaitlistDripEmails(projectId, email).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid waitlist payload." }, { status: 400 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to submit waitlist request." },
      { status: 500 },
    );
  }
}

