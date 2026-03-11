import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { buildLaunchPackZip } from "@/lib/launch-hub";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await context.params;

  try {
    const pack = await buildLaunchPackZip(userId, projectId);
    if (!pack) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    return new NextResponse(pack.buffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${pack.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to build launch pack" },
      { status: 500 },
    );
  }
}
