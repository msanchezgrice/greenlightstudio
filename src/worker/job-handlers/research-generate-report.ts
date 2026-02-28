import type { SupabaseClient } from "@supabase/supabase-js";
import { emitJobEvent } from "../job-events";
import { loadMemory, writeMemory, formatMemoryForPrompt } from "../memory";
import { executeAgentQuery, type StreamEvent } from "@/lib/agent";

const RESEARCHER_REPORT_PROFILE = {
  name: "researcher_report",
  tools: ["WebSearch", "WebFetch"],
  allowedTools: ["WebSearch", "WebFetch"],
  maxTurns: 15,
  timeoutMs: 900_000,
  permissionMode: "dontAsk" as const,
};

type SlideData = {
  title: string;
  bullets: string[];
  notes?: string;
};

type ResearchOutput = {
  title: string;
  executive_summary: string;
  slides: SlideData[];
  key_findings: string[];
};

export async function handleResearchGenerateReport(
  db: SupabaseClient,
  job: { id: string; project_id: string; payload: Record<string, unknown> }
) {
  const payload = job.payload ?? {};
  const projectId = (payload.projectId as string) ?? job.project_id;
  const ownerClerkId = payload.ownerClerkId as string;
  const topic = payload.topic as string;
  const format = (payload.format as string) ?? "pptx";
  const maxSlides = Math.max(3, Math.min(30, Number(payload.maxSlides ?? 15)));

  const project = await db
    .from("projects")
    .select("id,name,domain")
    .eq("id", projectId)
    .single();
  if (project.error || !project.data) throw new Error("Project not found");

  const memories = await loadMemory(db, projectId, ["fact", "context", "learning"]);
  const memoryContext = formatMemoryForPrompt(memories);

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "log",
    message: "Starting research",
  });

  const prompt = [
    `You are a research analyst producing a report for "${project.data.name}" (domain: ${project.data.domain ?? "unknown"}).`,
    "",
    memoryContext ? `## Project Context\n${memoryContext}\n` : "",
    `## Research Topic`,
    topic,
    "",
    `## Output Format`,
    `Return ONLY valid JSON with this structure (no markdown, no explanation):`,
    `{`,
    `  "title": "Report Title",`,
    `  "executive_summary": "2-3 sentence summary",`,
    `  "slides": [`,
    `    { "title": "Slide Title", "bullets": ["point 1", "point 2"], "notes": "optional speaker notes" }`,
    `  ],`,
    `  "key_findings": ["finding 1", "finding 2"]`,
    `}`,
    "",
    `Generate exactly ${maxSlides} slides. Each slide should have 3-5 bullet points.`,
    `Research thoroughly using web search. Include data, statistics, and sources.`,
  ].join("\n");

  let fullOutput = "";

  const hooks = {
    onStreamEvent: async (event: StreamEvent) => {
      if (event.type === "text_delta") {
        fullOutput += event.text;
        await emitJobEvent(db, {
          projectId,
          jobId: job.id,
          type: "delta",
          message: event.text,
        });
      } else if (event.type === "tool_use") {
        await emitJobEvent(db, {
          projectId,
          jobId: job.id,
          type: "tool_call",
          message: `Researching: ${event.tool}`,
          data: { tool: event.tool },
        });
      }
    },
  };

  await executeAgentQuery(
    projectId,
    ownerClerkId,
    prompt,
    RESEARCHER_REPORT_PROFILE,
    "phase0",
    hooks
  );

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "log",
    message: "Research complete, generating deliverable",
  });

  let research: ResearchOutput;
  try {
    const jsonMatch = fullOutput.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in output");
    research = JSON.parse(jsonMatch[0]) as ResearchOutput;
  } catch {
    research = {
      title: topic,
      executive_summary: fullOutput.slice(0, 500),
      slides: [{ title: topic, bullets: [fullOutput.slice(0, 200)] }],
      key_findings: [fullOutput.slice(0, 300)],
    };
  }

  let fileBuffer: Buffer;
  let fileExt: string;
  let mimeType: string;

  if (format === "pdf") {
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

    const titlePage = doc.addPage([792, 612]);
    titlePage.drawText(research.title, {
      x: 50,
      y: 400,
      size: 28,
      font: boldFont,
      color: rgb(0.1, 0.1, 0.1),
    });
    titlePage.drawText(research.executive_summary, {
      x: 50,
      y: 350,
      size: 12,
      font,
      color: rgb(0.3, 0.3, 0.3),
      maxWidth: 692,
    });

    for (const slide of research.slides) {
      const page = doc.addPage([792, 612]);
      page.drawText(slide.title, {
        x: 50,
        y: 550,
        size: 20,
        font: boldFont,
        color: rgb(0.1, 0.1, 0.1),
      });
      let y = 510;
      for (const bullet of slide.bullets) {
        page.drawText(`• ${bullet}`, {
          x: 70,
          y,
          size: 12,
          font,
          color: rgb(0.2, 0.2, 0.2),
          maxWidth: 652,
        });
        y -= 30;
        if (y < 50) break;
      }
    }

    const pdfBytes = await doc.save();
    fileBuffer = Buffer.from(pdfBytes);
    fileExt = "pdf";
    mimeType = "application/pdf";
  } else {
    const pptx = await import("pptxgenjs");
    const PptxGenJS = pptx.default || pptx;
    const pres = new PptxGenJS();
    pres.author = "Greenlight Studio";
    pres.subject = research.title;
    pres.title = research.title;

    const titleSlide = pres.addSlide();
    titleSlide.addText(research.title, {
      x: 0.5,
      y: 1.5,
      w: 9,
      fontSize: 32,
      bold: true,
      color: "1a1a1a",
    });
    titleSlide.addText(research.executive_summary, {
      x: 0.5,
      y: 3.5,
      w: 9,
      fontSize: 14,
      color: "666666",
    });

    for (const slide of research.slides) {
      const s = pres.addSlide();
      s.addText(slide.title, {
        x: 0.5,
        y: 0.3,
        w: 9,
        fontSize: 24,
        bold: true,
        color: "1a1a1a",
      });
      const bulletText = slide.bullets
        .map((b) => ({ text: b, options: { bullet: true, breakLine: true } }));
      s.addText(bulletText as Parameters<typeof s.addText>[0], {
        x: 0.5,
        y: 1.2,
        w: 9,
        h: 4.5,
        fontSize: 14,
        color: "333333",
        lineSpacing: 24,
      });
      if (slide.notes) {
        s.addNotes(slide.notes);
      }
    }

    const findingsSlide = pres.addSlide();
    findingsSlide.addText("Key Findings", {
      x: 0.5,
      y: 0.3,
      w: 9,
      fontSize: 24,
      bold: true,
      color: "1a1a1a",
    });
    const findingsText = research.key_findings
      .map((f) => ({ text: f, options: { bullet: true, breakLine: true } }));
    findingsSlide.addText(findingsText as Parameters<typeof findingsSlide.addText>[0], {
      x: 0.5,
      y: 1.2,
      w: 9,
      h: 4.5,
      fontSize: 14,
      color: "333333",
      lineSpacing: 24,
    });

    const pptxBuffer = (await pres.write({ outputType: "nodebuffer" })) as Buffer;
    fileBuffer = pptxBuffer;
    fileExt = "pptx";
    mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }

  const fileName = `${research.title.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 60)}.${fileExt}`;
  const storagePath = `${projectId}/reports/${fileName}`;

  const { error: uploadError } = await db.storage
    .from("project-assets")
    .upload(storagePath, fileBuffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const signed = await db.storage
    .from("project-assets")
    .createSignedUrl(storagePath, 60 * 60 * 24);
  const downloadUrl = signed.error ? null : signed.data.signedUrl;

  await emitJobEvent(db, {
    projectId,
    jobId: job.id,
    type: "artifact",
    message: `Report generated: ${fileName}`,
    data: {
      downloadUrl,
      storageBucket: "project-assets",
      storagePath,
      format: fileExt,
      fileName,
      slideCount: research.slides.length,
    },
  });

  await writeMemory(db, projectId, job.id, [
    {
      category: "context",
      key: `research_${topic.slice(0, 40).replace(/\s+/g, "_")}`,
      value: research.executive_summary,
      agentKey: "research",
    },
    ...research.key_findings.slice(0, 5).map((finding, i) => ({
      category: "fact" as const,
      key: `research_finding_${i}`,
      value: finding,
      agentKey: "research",
    })),
  ]);
}
