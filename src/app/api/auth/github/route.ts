import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/auth/github
 *
 * Initiates the GitHub OAuth flow by redirecting the user to GitHub's
 * authorization page. Encodes clerk_user_id and a redirect URL into the
 * OAuth state parameter to prevent CSRF and to route the user back after
 * authorization completes.
 *
 * Query params:
 *   redirect_uri - Where to send the user after the callback (default: /onboarding)
 */
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "GitHub OAuth is not configured." }, { status: 500 });
  }

  const url = new URL(req.url);
  const redirectUri = url.searchParams.get("redirect_uri") || "/onboarding";

  // Build the callback URL relative to the current origin
  const callbackUrl = new URL("/api/auth/github/callback", url.origin).toString();

  // Encode state as base64 JSON to verify on callback and prevent CSRF
  const state = Buffer.from(
    JSON.stringify({
      clerk_user_id: userId,
      redirect_uri: redirectUri,
      nonce: crypto.randomUUID(),
    }),
  ).toString("base64url");

  const githubAuthUrl = new URL("https://github.com/login/oauth/authorize");
  githubAuthUrl.searchParams.set("client_id", clientId);
  githubAuthUrl.searchParams.set("redirect_uri", callbackUrl);
  githubAuthUrl.searchParams.set("scope", "repo");
  githubAuthUrl.searchParams.set("state", state);

  return NextResponse.redirect(githubAuthUrl.toString());
}
