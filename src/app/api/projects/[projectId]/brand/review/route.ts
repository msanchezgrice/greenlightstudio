import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase";
import { runBrandConsistencyReview } from "@/lib/brand-consistency";

const bodySchema = z
  .object({
    phase: z.number().int().min(0).max(3).optional(),
  })
  .optional();

export async function POST(req: Request, context: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await context.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request payload." }, { status: 400 });
  }

  const db = createServiceSupabase();
  const { data: project } = await db
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("owner_clerk_id", userId)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  try {
    const result = await runBrandConsistencyReview({
      db,
      projectId,
      ownerClerkId: userId,
      phase: parsed.data?.phase ?? undefined,
      reason: "manual",
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run brand consistency review" },
      { status: 500 },
    );
  }
}
