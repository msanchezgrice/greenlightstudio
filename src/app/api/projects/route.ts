import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { onboardingSchema } from "@/types/domain";
import { create_project, upsertUser } from "@/lib/supabase-mcp";
import { withRetry } from "@/lib/retry";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = onboardingSchema.parse(await req.json());

  const clerkUser = await currentUser();
  const primaryEmail = clerkUser?.emailAddresses.find((entry) => entry.id === clerkUser.primaryEmailAddressId)?.emailAddress ?? null;

  try {
    const userRowId = await withRetry(() => upsertUser(userId, primaryEmail));
    const domains = Array.isArray(body.domains) ? body.domains.filter((entry) => typeof entry === "string" && entry.trim()) : [];
    const projectId = await withRetry(() =>
      create_project({
        ownerClerkId: userId,
        userId: userRowId,
        name: body.domain || domains[0] || body.idea_description.slice(0, 50),
        domain: body.domain ?? null,
        ideaDescription: body.idea_description,
        repoUrl: body.repo_url ?? null,
        runtimeMode: body.runtime_mode,
        permissions: body.permissions,
        nightShift: body.night_shift,
        focusAreas: body.focus_areas,
        scanResults: body.scan_results,
        wizardState: { step: "confirm", uploaded_files: body.uploaded_files ?? [], domains },
      }),
    );

    return NextResponse.json({ projectId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed creating project";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
