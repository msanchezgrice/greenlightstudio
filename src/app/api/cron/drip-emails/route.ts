import { NextResponse } from "next/server";
import { processWeeklyDigests, processNudgeEmails } from "@/lib/drip-emails";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const digest = await processWeeklyDigests();
  const nudge = await processNudgeEmails();

  return NextResponse.json({
    ran_at: new Date().toISOString(),
    digest,
    nudge,
  });
}
