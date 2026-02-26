import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

interface GitHubOAuthState {
  clerk_user_id: string;
  redirect_uri: string;
  nonce: string;
}

interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  error?: string;
  error_description?: string;
}

interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string;
}

/**
 * GET /api/auth/github/callback
 *
 * GitHub redirects here after the user authorizes the OAuth app.
 * Exchanges the authorization code for an access token, fetches basic
 * user info from GitHub, and stores the connection in Supabase.
 * Finally, redirects back to the onboarding wizard with a success indicator.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // GitHub may redirect back with an error (e.g. user denied access)
  if (error) {
    const redirectUrl = new URL("/onboarding", url.origin);
    redirectUrl.searchParams.set("github", "error");
    redirectUrl.searchParams.set("github_error", error);
    return NextResponse.redirect(redirectUrl.toString());
  }

  if (!code || !stateParam) {
    return NextResponse.json({ error: "Missing code or state parameter." }, { status: 400 });
  }

  // Decode and validate state
  let state: GitHubOAuthState;
  try {
    state = JSON.parse(Buffer.from(stateParam, "base64url").toString("utf-8"));
  } catch {
    return NextResponse.json({ error: "Invalid state parameter." }, { status: 400 });
  }

  // Verify the authenticated user matches the state to prevent CSRF
  const { userId } = await auth();
  if (!userId || userId !== state.clerk_user_id) {
    return NextResponse.json({ error: "Unauthorized: user mismatch." }, { status: 401 });
  }

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "GitHub OAuth is not configured." }, { status: 500 });
  }

  // Exchange authorization code for access token
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  const tokenData: GitHubTokenResponse = await tokenResponse.json();

  if (tokenData.error || !tokenData.access_token) {
    const redirectUrl = new URL(state.redirect_uri || "/onboarding", url.origin);
    redirectUrl.searchParams.set("github", "error");
    redirectUrl.searchParams.set("github_error", tokenData.error_description || tokenData.error || "token_exchange_failed");
    return NextResponse.redirect(redirectUrl.toString());
  }

  // Fetch GitHub user profile
  let githubUser: GitHubUser | null = null;
  try {
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (userResponse.ok) {
      githubUser = await userResponse.json();
    }
  } catch {
    // Non-fatal: we can store the connection without profile info
  }

  // Store connection in Supabase
  const db = createServiceSupabase();
  const { error: dbError } = await db.from("github_connections").upsert(
    {
      clerk_id: userId,
      github_token: tokenData.access_token,
      github_username: githubUser?.login ?? null,
      github_avatar_url: githubUser?.avatar_url ?? null,
      github_id: githubUser?.id ?? null,
      scopes: tokenData.scope ?? null,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clerk_id" },
  );

  if (dbError) {
    console.error("Failed to store GitHub connection:", dbError.message);
    const redirectUrl = new URL(state.redirect_uri || "/onboarding", url.origin);
    redirectUrl.searchParams.set("github", "error");
    redirectUrl.searchParams.set("github_error", "storage_failed");
    return NextResponse.redirect(redirectUrl.toString());
  }

  // Redirect back to the onboarding wizard with success
  const redirectUrl = new URL(state.redirect_uri || "/onboarding", url.origin);
  redirectUrl.searchParams.set("github", "connected");
  return NextResponse.redirect(redirectUrl.toString());
}
