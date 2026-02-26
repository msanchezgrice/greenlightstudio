import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";

export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.object({
  email: z.string().email().max(254),
  source: z.string().min(1).max(64).optional(),
});

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    const email = normalizeEmail(body.email);
    const source = body.source?.trim() || "landing_page";

    const db = createServiceSupabase();
    const { error } = await withRetry(() =>
      db.from("waitlist_signups").upsert(
        {
          email,
          source,
          metadata: {
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

