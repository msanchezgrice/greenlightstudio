import { GoogleGenAI } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabase } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";
import { log_task } from "@/lib/supabase-mcp";
import { recordProjectEvent } from "@/lib/project-events";

type ReviewReason =
  | "manual"
  | "phase0_auto"
  | "phase1_auto"
  | "phase2_auto"
  | "nightshift"
  | "scheduled";

type ReviewAsset = {
  id: string;
  filename: string;
  mime_type: string | null;
  storage_bucket: string;
  storage_path: string;
  metadata: Record<string, unknown> | null;
  phase: number | null;
};

type ReviewIssue = {
  filename: string;
  severity: "low" | "medium" | "high";
  issue: string;
  recommendation: string;
  redo: boolean;
};

type ReviewOutput = {
  summary: string;
  score: number;
  consistent: boolean;
  issues: ReviewIssue[];
  redo_filenames: string[];
};

export type BrandConsistencyResult = {
  score: number;
  consistent: boolean;
  summary: string;
  issues: ReviewIssue[];
  assetCount: number;
  redoAssetIds: string[];
  reportAssetId: string | null;
  reportPreviewUrl: string | null;
};

type BrandConsistencyOptions = {
  db?: SupabaseClient;
  projectId: string;
  ownerClerkId?: string | null;
  phase?: number | null;
  reason?: ReviewReason;
};

const DEFAULT_MODEL = "gemini-3.1-pro-preview";

function getGeminiClient() {
  const key = process.env.GEMINI_API_KEY?.trim() || process.env.NANOBANANA_GEMINI_API_KEY?.trim();
  if (!key) {
    throw new Error("Brand consistency review requires GEMINI_API_KEY or NANOBANANA_GEMINI_API_KEY");
  }
  return new GoogleGenAI({ apiKey: key });
}

function pickModel() {
  const model = process.env.GEMINI_CONSISTENCY_MODEL?.trim();
  return model && model.length > 0 ? model : DEFAULT_MODEL;
}

function parseModelOutput(raw: string): ReviewOutput {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Gemini consistency review returned no JSON payload");
  }
  const parsed = JSON.parse(jsonMatch[0]) as Partial<ReviewOutput>;

  const issues = Array.isArray(parsed.issues)
    ? parsed.issues
        .map((issue) => {
          if (!issue || typeof issue !== "object") return null;
          const row = issue as Record<string, unknown>;
          const severityRaw = typeof row.severity === "string" ? row.severity.toLowerCase() : "medium";
          const severity: ReviewIssue["severity"] =
            severityRaw === "high" || severityRaw === "low" ? severityRaw : "medium";
          const filename = typeof row.filename === "string" ? row.filename.trim() : "";
          const issueText = typeof row.issue === "string" ? row.issue.trim() : "";
          const recommendation = typeof row.recommendation === "string" ? row.recommendation.trim() : "";
          const redo = Boolean(row.redo);
          if (!filename || !issueText) return null;
          return {
            filename,
            severity,
            issue: issueText,
            recommendation: recommendation || "Regenerate asset with stricter brand guidance.",
            redo,
          } satisfies ReviewIssue;
        })
        .filter((entry): entry is ReviewIssue => Boolean(entry))
    : [];

  const redoFilenames = Array.isArray(parsed.redo_filenames)
    ? parsed.redo_filenames
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0)
    : issues.filter((issue) => issue.redo).map((issue) => issue.filename);

  return {
    summary:
      typeof parsed.summary === "string" && parsed.summary.trim().length > 0
        ? parsed.summary.trim()
        : "Consistency review completed.",
    score: Number.isFinite(parsed.score) ? Math.max(0, Math.min(100, Math.round(Number(parsed.score)))) : 70,
    consistent: Boolean(parsed.consistent),
    issues,
    redo_filenames: Array.from(new Set(redoFilenames)),
  };
}

function renderReviewMarkdown(input: {
  projectId: string;
  reason: ReviewReason;
  phase: number | null;
  model: string;
  output: ReviewOutput;
  reviewedAssets: ReviewAsset[];
}) {
  const lines: string[] = [];
  lines.push(`# Brand Consistency Review`);
  lines.push("");
  lines.push(`- generated_at: ${new Date().toISOString()}`);
  lines.push(`- project_id: ${input.projectId}`);
  lines.push(`- phase: ${input.phase ?? "all"}`);
  lines.push(`- reason: ${input.reason}`);
  lines.push(`- model: ${input.model}`);
  lines.push(`- assets_reviewed: ${input.reviewedAssets.length}`);
  lines.push(`- score: ${input.output.score}/100`);
  lines.push(`- consistent: ${input.output.consistent ? "yes" : "no"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(input.output.summary);
  lines.push("");
  lines.push("## Reviewed Assets");
  input.reviewedAssets.forEach((asset) => {
    lines.push(`- ${asset.filename} (phase ${asset.phase ?? "n/a"})`);
  });
  lines.push("");
  lines.push("## Issues");
  if (!input.output.issues.length) {
    lines.push("- No consistency or quality issues detected.");
  } else {
    input.output.issues.forEach((issue, index) => {
      lines.push(`${index + 1}. ${issue.filename} [${issue.severity}]`);
      lines.push(`   - issue: ${issue.issue}`);
      lines.push(`   - recommendation: ${issue.recommendation}`);
      lines.push(`   - redo: ${issue.redo ? "yes" : "no"}`);
    });
  }
  lines.push("");
  lines.push("## Redo Candidates");
  if (!input.output.redo_filenames.length) {
    lines.push("- none");
  } else {
    input.output.redo_filenames.forEach((filename) => lines.push(`- ${filename}`));
  }
  return lines.join("\n");
}

export async function runBrandConsistencyReview(options: BrandConsistencyOptions): Promise<BrandConsistencyResult> {
  const db = options.db ?? createServiceSupabase();
  const reason = options.reason ?? "manual";

  const { data: rawAssets, error: assetError } = await withRetry(() =>
    db
      .from("project_assets")
      .select("id,filename,mime_type,storage_bucket,storage_path,metadata,phase")
      .eq("project_id", options.projectId)
      .eq("status", "uploaded")
      .order("created_at", { ascending: false })
      .limit(200),
  );
  if (assetError) throw new Error(assetError.message);

  const assets = ((rawAssets ?? []) as ReviewAsset[]).filter((asset) => {
    const isImage = typeof asset.mime_type === "string" && asset.mime_type.startsWith("image/");
    if (!isImage) return false;
    if (typeof options.phase === "number" && asset.phase !== options.phase) return false;
    const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
    return metadata.brand_asset === true || metadata.phase0_brand_foundation === true || metadata.phase0_brand_asset === true;
  });

  if (!assets.length) {
    return {
      score: 0,
      consistent: true,
      summary: "No brand image assets found for consistency review.",
      issues: [],
      assetCount: 0,
      redoAssetIds: [],
      reportAssetId: null,
      reportPreviewUrl: null,
    };
  }

  await log_task(
    options.projectId,
    "brand_agent",
    "brand_consistency_review",
    "running",
    `Reviewing ${assets.length} brand assets for consistency (${reason})`,
  ).catch(() => {});

  const ai = getGeminiClient();
  const model = pickModel();
  const limitedAssets = assets.slice(0, 8);

  const parts: Array<Record<string, unknown>> = [
    {
      text: `You are a strict brand quality reviewer.
Evaluate the attached startup brand assets for consistency and production quality.
Return STRICT JSON only:
{
  "summary": "short assessment",
  "score": 0-100,
  "consistent": true/false,
  "issues": [
    {
      "filename": "asset file name",
      "severity": "low|medium|high",
      "issue": "specific issue",
      "recommendation": "how to improve",
      "redo": true/false
    }
  ],
  "redo_filenames": ["filename.png"]
}

Rules:
- Be specific and practical.
- Flag files for redo only when clearly inconsistent or low quality.
- Prefer concise output with concrete fixes.
- JSON only; no markdown fences.`,
    },
    {
      text: `Assets in scope:\n${limitedAssets.map((asset, index) => `${index + 1}. ${asset.filename}`).join("\n")}`,
    },
  ];

  for (const asset of limitedAssets) {
    const { data: file, error } = await db.storage.from(asset.storage_bucket).download(asset.storage_path);
    if (error || !file) continue;
    const bytes = Buffer.from(await file.arrayBuffer());
    parts.push({ text: `Asset: ${asset.filename}` });
    parts.push({
      inlineData: {
        mimeType: asset.mime_type ?? "image/png",
        data: bytes.toString("base64"),
      },
    });
  }

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
  });
  const responseText = (response.candidates?.[0]?.content?.parts ?? [])
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
  const output = parseModelOutput(responseText);

  const redoAssetIds = assets
    .filter((asset) => output.redo_filenames.includes(asset.filename))
    .map((asset) => asset.id);

  await Promise.all(
    assets.map((asset) =>
      withRetry(() =>
        db
          .from("project_assets")
          .update({
            metadata: {
              ...(asset.metadata ?? {}),
              consistency_review: {
                score: output.score,
                consistent: output.consistent,
                reviewed_at: new Date().toISOString(),
                reason,
                requires_redo: output.redo_filenames.includes(asset.filename),
              },
            },
          })
          .eq("id", asset.id),
      ).catch(() => {}),
    ),
  );

  const markdown = renderReviewMarkdown({
    projectId: options.projectId,
    reason,
    phase: options.phase ?? null,
    model,
    output,
    reviewedAssets: assets,
  });
  const reportPath = `${options.projectId}/brand/consistency-review${typeof options.phase === "number" ? `-phase-${options.phase}` : ""}.md`;

  await withRetry(() =>
    db.storage.from("project-assets").upload(reportPath, Buffer.from(markdown, "utf8"), {
      contentType: "text/markdown; charset=utf-8",
      upsert: true,
    }),
  );

  const { data: reportAsset } = await withRetry(() =>
    db
      .from("project_assets")
      .upsert(
        {
          project_id: options.projectId,
          phase: typeof options.phase === "number" ? options.phase : 1,
          kind: "upload",
          storage_bucket: "project-assets",
          storage_path: reportPath,
          filename: reportPath.split("/").pop() ?? "consistency-review.md",
          mime_type: "text/markdown",
          size_bytes: Buffer.byteLength(markdown, "utf8"),
          status: "uploaded",
          metadata: {
            auto_generated: true,
            brand_consistency_review: true,
            score: output.score,
            consistent: output.consistent,
            reason,
            redo_filenames: output.redo_filenames,
          },
          created_by: options.ownerClerkId ?? "system",
        },
        { onConflict: "project_id,storage_path" },
      )
      .select("id")
      .single(),
  );

  await recordProjectEvent(db, {
    projectId: options.projectId,
    eventType: "brand.consistency_review.completed",
    message: `Brand consistency review completed (${output.score}/100)`,
    data: {
      reason,
      score: output.score,
      consistent: output.consistent,
      asset_count: assets.length,
      redo_filenames: output.redo_filenames,
      report_asset_id: reportAsset?.id ?? null,
    },
    agentKey: "brand",
  });

  await log_task(
    options.projectId,
    "brand_agent",
    "brand_consistency_review",
    output.redo_filenames.length > 0 ? "failed" : "completed",
    output.redo_filenames.length > 0
      ? `Consistency review flagged ${output.redo_filenames.length} asset(s) for redo`
      : `Consistency review passed (${output.score}/100)`,
  ).catch(() => {});

  return {
    score: output.score,
    consistent: output.consistent,
    summary: output.summary,
    issues: output.issues,
    assetCount: assets.length,
    redoAssetIds,
    reportAssetId: (reportAsset?.id as string | undefined) ?? null,
    reportPreviewUrl: reportAsset?.id ? `/api/projects/${options.projectId}/assets/${reportAsset.id}/preview` : null,
  };
}
