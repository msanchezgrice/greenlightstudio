import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * GET /api/auth/github/status
 *
 * Returns the GitHub connection status for the current authenticated user.
 * Response: { connected: boolean, username?: string, avatar_url?: string }
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceSupabase();
  const { data, error } = await db
    .from("github_connections")
    .select("github_username, github_avatar_url")
    .eq("clerk_id", userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    username: data.github_username ?? undefined,
    avatar_url: data.github_avatar_url ?? undefined,
  });
}
