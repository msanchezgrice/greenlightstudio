import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getLaunchHubResponse } from "@/lib/launch-hub";

export async function GET(_: Request, context: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await context.params;

  try {
    const data = await getLaunchHubResponse(userId, projectId);
    if (!data) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load launch hub" },
      { status: 500 },
    );
  }
}
