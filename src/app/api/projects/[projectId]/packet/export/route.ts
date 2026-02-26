import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { packetSchema } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

function wrapLines(input: string, maxChars: number) {
  const words = input.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function GET(_: Request, context: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await context.params;
  const db = createServiceSupabase();

  const [{ data: project, error: projectError }, { data: packetRow, error: packetError }] = await Promise.all([
    withRetry(() => db.from("projects").select("id,owner_clerk_id,name").eq("id", projectId).single()),
    withRetry(() => db.from("phase_packets").select("packet").eq("project_id", projectId).eq("phase", 0).single()),
  ]);

  if (projectError || !project || project.owner_clerk_id !== userId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (packetError || !packetRow) {
    return NextResponse.json({ error: "Packet not found" }, { status: 404 });
  }

  const parsed = packetSchema.safeParse(packetRow.packet);
  if (!parsed.success) {
    return NextResponse.json({ error: "Packet failed schema validation." }, { status: 400 });
  }
  const packet = parsed.data;

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const margin = 50;
  let y = 760;

  const draw = (text: string, options?: { bold?: boolean; size?: number; color?: ReturnType<typeof rgb> }) => {
    const size = options?.size ?? 11;
    const usedFont = options?.bold ? bold : font;
    page.drawText(text, {
      x: margin,
      y,
      size,
      font: usedFont,
      color: options?.color ?? rgb(0.09, 0.11, 0.16),
    });
    y -= size + 4;
  };

  const drawParagraph = (text: string, maxChars = 90) => {
    const lines = wrapLines(text, maxChars);
    for (const line of lines) draw(line);
    y -= 6;
  };

  draw(`Greenlight Studio — Phase 0 Packet`, { bold: true, size: 18, color: rgb(0.13, 0.67, 0.33) });
  draw(`Project: ${project.name as string}`, { bold: true, size: 13 });
  draw(`Generated: ${new Date().toLocaleString()}`);
  y -= 10;

  draw("Tagline", { bold: true });
  drawParagraph(packet.tagline);

  draw("Elevator Pitch", { bold: true });
  drawParagraph(packet.elevator_pitch, 95);

  draw("Recommendation", { bold: true });
  draw(`${packet.recommendation.toUpperCase()} (${packet.reasoning_synopsis.confidence}/100 confidence)`);
  y -= 6;

  draw("Market Sizing", { bold: true });
  draw(`TAM: ${packet.market_sizing.tam}`);
  draw(`SAM: ${packet.market_sizing.sam}`);
  draw(`SOM: ${packet.market_sizing.som}`);
  y -= 6;

  draw("Target Persona", { bold: true });
  draw(`${packet.target_persona.name}: ${packet.target_persona.description}`);
  draw(`Pain points: ${packet.target_persona.pain_points.join(", ")}`);
  y -= 6;

  draw("MVP Scope", { bold: true });
  draw(`In scope: ${packet.mvp_scope.in_scope.join(", ")}`);
  draw(`Deferred: ${packet.mvp_scope.deferred.join(", ")}`);
  y -= 6;

  draw("Competitor Analysis", { bold: true });
  for (const competitor of packet.competitor_analysis.slice(0, 5)) {
    draw(`${competitor.name} — ${competitor.positioning}`);
    draw(`Gap: ${competitor.gap} | Pricing: ${competitor.pricing}`);
    y -= 2;
  }

  y -= 4;
  draw("Reasoning Synopsis", { bold: true });
  draw(`Decision: ${packet.reasoning_synopsis.decision}`);
  draw(`Rationale: ${packet.reasoning_synopsis.rationale.join(" | ")}`);
  draw(`Risks: ${packet.reasoning_synopsis.risks.join(" | ")}`);
  draw(`Next actions: ${packet.reasoning_synopsis.next_actions.join(" | ")}`);

  const bytes = await pdf.save();
  const safeProjectName = String(project.name ?? "project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename=\"${safeProjectName || "project"}-phase0-packet.pdf\"`,
      "cache-control": "no-store",
    },
  });
}
