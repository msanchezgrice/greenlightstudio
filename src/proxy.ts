import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/launch/(.*)",
  "/packet/share/(.*)",
  "/plan-review",
  "/plan-review/(.*)",
  "/onboarding",
  "/onboarding/(.*)",
  "/api/onboarding/scan",
  "/api/waitlist",
  "/api/nightshift/run",
  "/api/scheduler/run",
  "/api/email/inbound",
  "/api/cron/drip-emails",
  "/api/projects/(.*)/launch",
  // These APIs enforce auth/ownership in-route; keep middleware from rewriting signed-out calls to /404.
  "/api/projects/(.*)/chat",
  "/api/projects/(.*)/events",
  "/api/projects/(.*)/agents/live",
  "/api/projects/(.*)/brain",
  "/api/projects/(.*)/analytics/events",
  "/api/projects/(.*)/payments/events",
  "/api/projects/(.*)/integrations/(.*)",
  "/api/projects/(.*)/assets/(.*)/preview",
  "/api/inbox/(.*)/decision",
  "/sign-in(.*)",
  "/sign-up(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
