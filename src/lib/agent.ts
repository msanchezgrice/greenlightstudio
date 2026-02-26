import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync } from "node:fs";
import path from "node:path";
import { requireEnv } from "@/lib/env";
import { packetSchema, type OnboardingInput, type Packet, type ProjectAsset } from "@/types/domain";
import {
  phase1PacketSchema,
  phase2PacketSchema,
  phase3PacketSchema,
  type Phase1Packet,
  type Phase2Packet,
  type Phase3Packet,
} from "@/types/phase-packets";
import { z } from "zod";

const AGENT_QUERY_TIMEOUT_MS = Math.max(30_000, Number(process.env.CLAUDE_AGENT_QUERY_TIMEOUT_MS ?? 120_000));
const AGENT_QUERY_MAX_TURNS = 12;
const AGENT_RUNTIME_TMP_DIR = process.env.CLAUDE_SDK_TMPDIR?.trim() || "/tmp";
const IS_SERVERLESS_RUNTIME = Boolean(process.env.VERCEL || process.env.LAMBDA_TASK_ROOT);

const researchSchema = z.object({
  competitors: z.array(
    z.object({
      name: z.string(),
      positioning: z.string(),
      gap: z.string(),
      pricing: z.string(),
    }),
  ),
  market_sizing: z.object({ tam: z.string(), sam: z.string(), som: z.string() }),
  notes: z.array(z.string()),
});

const projectChatReplySchema = z.object({
  reply: z.string().min(1).max(4000),
});

const phase0RevisionPatchSchema = z
  .object({
    tagline: z.string().optional(),
    elevator_pitch: z.string().optional(),
    confidence_breakdown: packetSchema.shape.confidence_breakdown.optional(),
    competitor_analysis: packetSchema.shape.competitor_analysis.optional(),
    market_sizing: packetSchema.shape.market_sizing.optional(),
    target_persona: packetSchema.shape.target_persona.optional(),
    mvp_scope: packetSchema.shape.mvp_scope.optional(),
    existing_presence: packetSchema.shape.existing_presence.optional(),
    recommendation: packetSchema.shape.recommendation.optional(),
    reasoning_synopsis: packetSchema.shape.reasoning_synopsis.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one patch field must be provided.",
  });

type ProjectChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type ProjectChatInput = {
  project: {
    id: string;
    name: string;
    domain: string | null;
    phase: number;
    idea_description: string;
    repo_url: string | null;
    runtime_mode: "shared" | "attached";
    focus_areas: string[];
  };
  latestPacket: {
    phase: number;
    confidence: number;
    recommendation: string | null;
    summary: string | null;
  } | null;
  recentTasks: Array<{
    agent: string;
    description: string;
    status: string;
    detail: string | null;
    created_at: string;
  }>;
  recentApprovals: Array<{
    title: string;
    status: string;
    risk: string;
    created_at: string;
  }>;
  messages: ProjectChatMessage[];
};

function sdkEnv() {
  const base = { ...process.env, ANTHROPIC_API_KEY: requireEnv("ANTHROPIC_API_KEY") };
  if (!IS_SERVERLESS_RUNTIME) return base;

  return {
    ...base,
    HOME: AGENT_RUNTIME_TMP_DIR,
    TMPDIR: AGENT_RUNTIME_TMP_DIR,
    XDG_CONFIG_HOME: path.join(AGENT_RUNTIME_TMP_DIR, ".config"),
    XDG_CACHE_HOME: path.join(AGENT_RUNTIME_TMP_DIR, ".cache"),
  };
}

let cachedClaudeCodeExecutablePath: string | null = null;

function resolveClaudeCodeExecutablePath() {
  if (cachedClaudeCodeExecutablePath) return cachedClaudeCodeExecutablePath;

  if (process.env.CLAUDE_CODE_EXECUTABLE_PATH?.trim()) {
    cachedClaudeCodeExecutablePath = process.env.CLAUDE_CODE_EXECUTABLE_PATH.trim();
    return cachedClaudeCodeExecutablePath;
  }

  const lambdaTaskRoot = process.env.LAMBDA_TASK_ROOT?.trim();
  const candidatePaths = [
    path.join(process.cwd(), "node_modules/@anthropic-ai/claude-agent-sdk/cli.js"),
    path.join(process.cwd(), ".next/server/node_modules/@anthropic-ai/claude-agent-sdk/cli.js"),
    path.join(process.cwd(), ".vercel/output/functions", "api", "projects", "[projectId]", "launch.func", "node_modules/@anthropic-ai/claude-agent-sdk/cli.js"),
    path.join(process.cwd(), ".vercel/output/functions", "api", "inbox", "[approvalId]", "decision.func", "node_modules/@anthropic-ai/claude-agent-sdk/cli.js"),
    path.join(process.cwd(), ".vercel/output/functions", "api", "projects", "[projectId]", "chat.func", "node_modules/@anthropic-ai/claude-agent-sdk/cli.js"),
    lambdaTaskRoot ? path.join(lambdaTaskRoot, "node_modules/@anthropic-ai/claude-agent-sdk/cli.js") : null,
    "/var/task/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
  ].filter((value): value is string => Boolean(value));

  const resolved = candidatePaths.find((candidate) => existsSync(candidate));
  if (!resolved) {
    throw new Error("Claude Code executable not found in runtime filesystem.");
  }

  cachedClaudeCodeExecutablePath = resolved;
  return resolved;
}

function extractDeltaText(event: unknown) {
  if (!event || typeof event !== "object") return "";
  const eventRecord = event as Record<string, unknown>;

  if (eventRecord.type === "content_block_start") {
    const block = eventRecord.content_block;
    if (block && typeof block === "object") {
      const blockRecord = block as Record<string, unknown>;
      if (blockRecord.type === "text" && typeof blockRecord.text === "string") return blockRecord.text;
    }
  }

  if (eventRecord.type === "content_block_delta") {
    const delta = eventRecord.delta;
    if (delta && typeof delta === "object") {
      const deltaRecord = delta as Record<string, unknown>;
      if (deltaRecord.type === "text_delta" && typeof deltaRecord.text === "string") return deltaRecord.text;
    }
  }

  return "";
}

function extractJsonDelta(event: unknown) {
  if (!event || typeof event !== "object") return "";
  const eventRecord = event as Record<string, unknown>;
  if (eventRecord.type !== "content_block_delta") return "";
  const delta = eventRecord.delta;
  if (!delta || typeof delta !== "object") return "";
  const deltaRecord = delta as Record<string, unknown>;
  if (deltaRecord.type !== "input_json_delta") return "";
  return typeof deltaRecord.partial_json === "string" ? deltaRecord.partial_json : "";
}

function parsePermissionDenials(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const denials = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      if (typeof record.tool_name !== "string") return null;
      return record.tool_name;
    })
    .filter((entry): entry is string => Boolean(entry));

  if (!denials.length) return null;
  return `Permission denied for tools: ${denials.join(", ")}`;
}

function parseResultErrors(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const errors = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return errors.length ? errors.join(" | ") : null;
}

type QueryProfile = {
  name: "structured_default" | "text_default";
  useOutputFormat: boolean;
};

type AgentProfile = {
  name: string;
  tools: string[];
  allowedTools: string[];
  maxTurns: number;
  permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk';
};

const AGENT_PROFILES: Record<string, AgentProfile> = {
  ceo: {
    name: 'ceo_agent',
    tools: ['WebSearch', 'WebFetch'],
    allowedTools: ['WebSearch', 'WebFetch'],
    maxTurns: 12,
    permissionMode: 'dontAsk',
  },
  research: {
    name: 'research_agent',
    tools: ['WebSearch', 'WebFetch'],
    allowedTools: ['WebSearch', 'WebFetch'],
    maxTurns: 8,
    permissionMode: 'dontAsk',
  },
  design: {
    name: 'design_agent',
    tools: ['WebSearch', 'WebFetch'],
    allowedTools: ['WebSearch', 'WebFetch'],
    maxTurns: 10,
    permissionMode: 'dontAsk',
  },
  chat: {
    name: 'ceo_chat',
    tools: ['WebSearch', 'WebFetch'],
    allowedTools: ['WebSearch', 'WebFetch'],
    maxTurns: 6,
    permissionMode: 'dontAsk',
  },
  none: {
    name: 'default',
    tools: [],
    allowedTools: [],
    maxTurns: 12,
    permissionMode: 'default',
  },
};

type QueryAttemptOptions<T> = {
  repair?: (value: unknown) => unknown;
  schema: z.ZodType<T>;
};

type QueryState = {
  messageCounts: Map<string, number>;
  resultSubtypes: string[];
  sawResult: boolean;
};

function bumpCount(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function describeQueryState(state: QueryState) {
  const counts = Array.from(state.messageCounts.entries())
    .map(([type, count]) => `${type}:${count}`)
    .join(",");
  const subtypes = state.resultSubtypes.length ? state.resultSubtypes.join(",") : "none";
  return `messages=[${counts || "none"}] result_subtypes=[${subtypes}]`;
}

function summarizeStderr(stderrChunks: string[]) {
  const merged = stderrChunks.join("").trim();
  if (!merged) return null;
  if (merged.length <= 700) return merged;
  return `...${merged.slice(-700)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRetryableAgentFailure(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("timed out") ||
    lower.includes("without result message") ||
    lower.includes("empty response") ||
    lower.includes("structured output retries") ||
    lower.includes("invalid input:")
  );
}

function parseSchemaWithRepair<T>(input: unknown, options: QueryAttemptOptions<T>) {
  const direct = options.schema.safeParse(input);
  if (direct.success) return direct.data;
  if (!options.repair) throw direct.error;

  const repaired = options.repair(input);
  const repairedResult = options.schema.safeParse(repaired);
  if (repairedResult.success) return repairedResult.data;

  throw repairedResult.error;
}

function createToolGuard(profile: AgentProfile) {
  if (profile.tools.length === 0) return undefined;

  const allowed = new Set(profile.tools);
  return async (toolName: string, _input: Record<string, unknown>) => {
    if (allowed.has(toolName)) {
      return { behavior: 'allow' as const };
    }
    return {
      behavior: 'deny' as const,
      message: `Tool "${toolName}" is not permitted for ${profile.name}`,
    };
  };
}

async function executeQueryAttempt<T>(prompt: string, options: QueryAttemptOptions<T>, profile: QueryProfile, agentProfile: AgentProfile = AGENT_PROFILES.none) {
  const executablePath = resolveClaudeCodeExecutablePath();
  const stderrChunks: string[] = [];
  const cwd = IS_SERVERLESS_RUNTIME ? AGENT_RUNTIME_TMP_DIR : process.cwd();
  const stream = query({
    prompt,
    options: {
      model: "sonnet",
      env: sdkEnv(),
      pathToClaudeCodeExecutable: executablePath,
      maxTurns: agentProfile.maxTurns,
      includePartialMessages: true,
      persistSession: false,
      cwd,
      settingSources: [],
      tools: agentProfile.tools.length > 0 ? agentProfile.tools : [],
      ...(agentProfile.allowedTools.length > 0 ? { allowedTools: agentProfile.allowedTools } : {}),
      ...(agentProfile.permissionMode !== 'default' ? { permissionMode: agentProfile.permissionMode } : {}),
      ...(agentProfile.tools.length > 0 ? { canUseTool: createToolGuard(agentProfile) } : {}),
      stderr: (data) => {
        stderrChunks.push(data);
      },
      ...(profile.useOutputFormat
        ? {
            outputFormat: {
              type: "json_schema" as const,
              schema: z.toJSONSchema(options.schema),
            },
          }
        : {}),
    },
  });

  let raw = "";
  let streamedRaw = "";
  let streamedJsonRaw = "";
  let resultText = "";
  let structuredOutput: unknown = undefined;
  let resultError: string | null = null;
  let timedOut = false;
  const state: QueryState = {
    messageCounts: new Map(),
    resultSubtypes: [],
    sawResult: false,
  };

  const timeout = setTimeout(() => {
    timedOut = true;
    stream.close();
  }, AGENT_QUERY_TIMEOUT_MS);

  try {
    for await (const message of stream) {
      bumpCount(state.messageCounts, message.type);

      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text") raw += block.text;
        }
        continue;
      }

      if (message.type === "stream_event") {
        streamedRaw += extractDeltaText(message.event);
        streamedJsonRaw += extractJsonDelta(message.event);
        continue;
      }

      if (message.type === "result") {
        state.sawResult = true;
        state.resultSubtypes.push(message.subtype);
        const permissionDenial = parsePermissionDenials(message.permission_denials);
        if (message.is_error) {
          const errorDetail = parseResultErrors(message.errors);
          resultError = [errorDetail, permissionDenial, `Agent query failed (${message.subtype})`, describeQueryState(state)]
            .filter((entry): entry is string => Boolean(entry))
            .join(" | ");
          continue;
        }

        if (typeof message.result === "string") {
          resultText += message.result;
        }
        if (typeof message.structured_output !== "undefined") {
          structuredOutput = message.structured_output;
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  const finalText = streamedJsonRaw.trim() || raw.trim() || streamedRaw.trim() || resultText.trim();

  const parseFinalText = () => parseSchemaWithRepair(parseAgentJson<T>(finalText), options);

  if (timedOut) {
    if (finalText) {
      try {
        return parseFinalText();
      } catch {
        // Continue to timeout error when partial text is not parseable.
      }
    }
    const stderrTail = summarizeStderr(stderrChunks);
    throw new Error(
      `Agent query timed out after ${Math.round(AGENT_QUERY_TIMEOUT_MS / 1000)}s | ${describeQueryState(state)}${
        stderrTail ? ` | stderr=${stderrTail}` : ""
      }`,
    );
  }

  if (!state.sawResult) {
    if (finalText) {
      try {
        return parseFinalText();
      } catch {
        // Continue to explicit missing-result error for visibility.
      }
    }
    const stderrTail = summarizeStderr(stderrChunks);
    throw new Error(
      `Agent stream ended without result message | ${describeQueryState(state)}${stderrTail ? ` | stderr=${stderrTail}` : ""}`,
    );
  }

  if (typeof structuredOutput !== "undefined") {
    return parseSchemaWithRepair(structuredOutput, options);
  }

  if (resultError && !finalText) throw new Error(resultError);
  if (!finalText) {
    const stderrTail = summarizeStderr(stderrChunks);
    throw new Error(`Agent returned empty response | ${describeQueryState(state)}${stderrTail ? ` | stderr=${stderrTail}` : ""}`);
  }
  return parseFinalText();
}

async function runJsonQuery<T>(prompt: string, schema: z.ZodType<T>, repair?: (value: unknown) => unknown, agentProfile: AgentProfile = AGENT_PROFILES.none) {
  const profiles: QueryProfile[] = [
    { name: "structured_default", useOutputFormat: true },
    { name: "text_default", useOutputFormat: false },
  ];

  const errors: string[] = [];
  for (const profile of profiles) {
    try {
      return await executeQueryAttempt(prompt, { schema, repair }, profile, agentProfile);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown query error";
      errors.push(`${profile.name}: ${message}`);
      if (!isRetryableAgentFailure(message)) break;
    }
  }

  throw new Error(errors.join(" || "));
}

function stripMarkdownCodeFence(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function parseAgentJson<T>(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim() ?? null;
  const objectCandidateMatch = raw.match(/\{[\s\S]*\}/);
  const objectCandidate = objectCandidateMatch?.[0]?.trim() ?? null;
  const candidates = [raw.trim(), stripMarkdownCodeFence(raw), fenced, objectCandidate].filter((candidate): candidate is string =>
    Boolean(candidate && candidate.trim()),
  );

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Try next candidate.
    }
  }

  throw new Error("Agent returned non-JSON output");
}

function normalizePhase0PacketCandidate(value: unknown) {
  if (!isRecord(value)) return value;
  const next: Record<string, unknown> = { ...value };

  if (Array.isArray(next.existing_presence)) {
    next.existing_presence = next.existing_presence.map((entry) => {
      if (!isRecord(entry)) return entry;
      const scannedAtRaw = entry.scanned_at;
      const scannedAt =
        typeof scannedAtRaw === "string" && scannedAtRaw.trim()
          ? scannedAtRaw
          : new Date().toISOString();

      return {
        ...entry,
        domain: typeof entry.domain === "string" ? entry.domain : String(entry.domain ?? ""),
        status: typeof entry.status === "string" ? entry.status : String(entry.status ?? ""),
        detail: typeof entry.detail === "string" ? entry.detail : String(entry.detail ?? ""),
        scanned_at: scannedAt,
      };
    });
  }

  const synopsis = next.reasoning_synopsis;
  if (isRecord(synopsis) && Array.isArray(synopsis.evidence)) {
    synopsis.evidence = synopsis.evidence.map((entry) => {
      if (isRecord(entry)) {
        return {
          claim: typeof entry.claim === "string" ? entry.claim : String(entry.claim ?? ""),
          source: typeof entry.source === "string" ? entry.source : "Model output",
        };
      }
      if (typeof entry === "string") {
        return { claim: entry, source: "Model output" };
      }
      return { claim: String(entry ?? ""), source: "Model output" };
    });
    next.reasoning_synopsis = synopsis;
  }

  return next;
}

function formatAttachedFilesBlock(assets: ProjectAsset[]) {
  if (!assets.length) return "";
  const fileList = assets
    .map((asset) => {
      const sizeKb = Math.round(asset.size_bytes / 1024);
      return `- ${asset.filename} (${asset.mime_type}, ${sizeKb} KB)`;
    })
    .join("\n");
  return `\nAttached documents uploaded by the user:
${fileList}
These files were provided as supporting materials for this project. Factor their existence and types into your analysis. Reference them by filename when relevant.`;
}

async function runResearchAgent(input: OnboardingInput, revisionGuidance?: string | null, assets?: ProjectAsset[]) {
  const guidanceBlock = revisionGuidance?.trim()
    ? `\nRevision guidance from user:\n${revisionGuidance.trim()}\nPrioritize this guidance in your research framing.`
    : "";
  const attachedFilesBlock = formatAttachedFilesBlock(assets ?? []);
  const prompt = `You are Research Agent. Return STRICT JSON only.
Input:\n${JSON.stringify({ domain: input.domain, idea_description: input.idea_description })}
${guidanceBlock}${attachedFilesBlock}

Required JSON shape:
{
  "competitors": [{"name":"","positioning":"","gap":"","pricing":""}],
  "market_sizing": {"tam":"", "sam":"", "som":""},
  "notes": ["", ""]
}

Rules:
- minimum 3 competitors
- no markdown
- no trailing text`;

  return runJsonQuery(prompt, researchSchema, undefined, AGENT_PROFILES.research);
}

export async function generatePhase0Packet(
  input: OnboardingInput,
  revisionGuidance?: string | null,
  priorPacket?: Packet | null,
  assets?: ProjectAsset[],
): Promise<Packet> {
  const trimmedGuidance = revisionGuidance?.trim() || "";
  const attachedFilesBlock = formatAttachedFilesBlock(assets ?? []);

  if (trimmedGuidance && priorPacket) {
    const revisionPrompt = `You are CEO Agent. Create a minimal JSON patch for a Phase 0 packet revision.
Return STRICT JSON only. Include only fields that must change based on guidance.

Allowed keys:
- tagline
- elevator_pitch
- confidence_breakdown
- competitor_analysis
- market_sizing
- target_persona
- mvp_scope
- existing_presence
- recommendation
- reasoning_synopsis

Project context:
${JSON.stringify({ domain: input.domain, idea_description: input.idea_description, repo_url: input.repo_url }, null, 2)}
${attachedFilesBlock}

User revision guidance:
${trimmedGuidance}

Current packet summary:
${JSON.stringify(
  {
    tagline: priorPacket.tagline,
    recommendation: priorPacket.recommendation,
    confidence_breakdown: priorPacket.confidence_breakdown ?? null,
    market_sizing: priorPacket.market_sizing,
    target_persona: priorPacket.target_persona,
    reasoning_synopsis: priorPacket.reasoning_synopsis,
  },
  null,
  2,
)}

Rules:
- Return only JSON patch fields, no wrapper key.
- If guidance affects reasoning, include reasoning_synopsis with updated decision/confidence/rationale/risks/next_actions/evidence.
- Keep evidence as objects with claim and source.
- No markdown, no placeholders, no extra keys.`;

    try {
      const patch = await runJsonQuery(revisionPrompt, phase0RevisionPatchSchema, undefined, AGENT_PROFILES.ceo);
      const mergedCandidate = {
        ...priorPacket,
        ...patch,
        confidence_breakdown: patch.confidence_breakdown ?? priorPacket.confidence_breakdown,
        competitor_analysis: patch.competitor_analysis ?? priorPacket.competitor_analysis,
        market_sizing: patch.market_sizing ?? priorPacket.market_sizing,
        target_persona: patch.target_persona ?? priorPacket.target_persona,
        mvp_scope: patch.mvp_scope ?? priorPacket.mvp_scope,
        existing_presence: patch.existing_presence ?? priorPacket.existing_presence,
        reasoning_synopsis: patch.reasoning_synopsis ?? priorPacket.reasoning_synopsis,
      };
      return packetSchema.parse(normalizePhase0PacketCandidate(mergedCandidate));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown packet revision failure";
      throw new Error(`phase0_ceo_query: ${message}`);
    }
  }

  let research: z.infer<typeof researchSchema>;
  try {
    research = await runResearchAgent(input, trimmedGuidance, assets);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown research failure";
    throw new Error(`phase0_research_query: ${message}`);
  }
  const guidanceBlock = trimmedGuidance
    ? `\nRevision guidance from user:\n${trimmedGuidance}\nYou MUST incorporate this guidance when shaping recommendation and next_actions.`
    : "";

  const prompt = `You are CEO Agent. Generate STRICT JSON for a Phase 0 packet.
Use this onboarding input:\n${JSON.stringify(input)}
Use this research brief:\n${JSON.stringify(research)}
${guidanceBlock}${attachedFilesBlock}

Return only JSON with these keys:
- tagline
- elevator_pitch
- confidence_breakdown { market, competition, feasibility, timing }
- competitor_analysis
- market_sizing
- target_persona { name, description, pain_points[] }
- mvp_scope { in_scope[], deferred[] }
- existing_presence [{ domain, status, detail, scanned_at }]
- recommendation (greenlight|revise|kill)
- reasoning_synopsis { decision, confidence, rationale[], risks[], next_actions[], evidence[] }

Rules:
- no placeholders
- no markdown
- no extra keys
- reasoning_synopsis.confidence must be 0-100 integer
- confidence_breakdown values must be 0-100 integers`;

  try {
    return await runJsonQuery(prompt, packetSchema, normalizePhase0PacketCandidate, AGENT_PROFILES.ceo);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown packet synthesis failure";
    throw new Error(`phase0_ceo_query: ${message}`);
  }
}

function truncateText(value: string, limit = 500) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}…`;
}

export async function generateProjectChatReply(input: ProjectChatInput): Promise<string> {
  const context = {
    project: {
      ...input.project,
      idea_description: truncateText(input.project.idea_description, 800),
    },
    latestPacket: input.latestPacket,
    recentTasks: input.recentTasks.slice(0, 12).map((task) => ({
      ...task,
      detail: task.detail ? truncateText(task.detail, 220) : null,
    })),
    recentApprovals: input.recentApprovals.slice(0, 8),
    messages: input.messages.slice(-12).map((message) => ({
      role: message.role,
      content: truncateText(message.content, 1200),
    })),
  };

  const prompt = `You are the Startup Machine CEO chat assistant.

Return STRICT JSON only:
{
  "reply": "string"
}

User project context:
${JSON.stringify(context, null, 2)}

Behavior rules:
- Be specific to this project context, packet state, and recent task statuses.
- If the user asks for next steps, provide concrete, actionable steps in order.
- If information is missing, say exactly what is missing and how to get it.
- Keep tone concise and operational.
- No markdown code fences.
- No placeholder text.
- Reply in <= 180 words unless user explicitly asks for more detail.`;

  const parsed = await runJsonQuery(prompt, projectChatReplySchema, undefined, AGENT_PROFILES.chat);
  const reply = parsed.reply.trim();
  if (!reply) {
    throw new Error("Chat reply was empty");
  }
  return reply;
}

type PhaseGenerationInput = {
  project_name: string;
  domain: string | null | undefined;
  idea_description: string;
  repo_url: string | null | undefined;
  runtime_mode: "shared" | "attached";
  permissions: {
    repo_write: boolean;
    deploy: boolean;
    ads_enabled?: boolean;
    ads_budget_cap: number;
    email_send: boolean;
  };
  night_shift: boolean;
  focus_areas: string[];
  scan_results: Record<string, unknown> | null;
  revision_guidance?: string | null;
};

function phaseContext(input: PhaseGenerationInput) {
  return JSON.stringify(
    {
      project_name: input.project_name,
      domain: input.domain,
      idea_description: input.idea_description,
      repo_url: input.repo_url,
      runtime_mode: input.runtime_mode,
      permissions: input.permissions,
      night_shift: input.night_shift,
      focus_areas: input.focus_areas,
      scan_results: input.scan_results,
      revision_guidance: input.revision_guidance ?? null,
    },
    null,
    2,
  );
}

export async function generatePhase1Packet(input: PhaseGenerationInput): Promise<Phase1Packet> {
  const prompt = `You are CEO Agent. Generate STRICT JSON for Startup Machine PHASE 1 (Validate).
Return ONLY valid JSON with this exact shape:
{
  "phase": 1,
  "summary": "string",
  "landing_page": {
    "headline": "string",
    "subheadline": "string",
    "primary_cta": "string",
    "sections": ["string", "string", "string"],
    "launch_notes": ["string", "string"]
  },
  "waitlist": {
    "capture_stack": "string",
    "double_opt_in": true,
    "form_fields": ["string", "string"],
    "target_conversion_rate": "string"
  },
  "analytics": {
    "provider": "string",
    "events": ["string", "string", "string"],
    "dashboard_views": ["string", "string"]
  },
  "brand_kit": {
    "voice": "string",
    "color_palette": ["string", "string", "string"],
    "font_pairing": "string",
    "logo_prompt": "string"
  },
  "social_strategy": {
    "channels": ["string", "string"],
    "content_pillars": ["string", "string", "string"],
    "posting_cadence": "string"
  },
  "email_sequence": {
    "emails": [
      {"day": "Day 0", "subject": "string", "goal": "string"},
      {"day": "Day 2", "subject": "string", "goal": "string"},
      {"day": "Day 5", "subject": "string", "goal": "string"}
    ]
  },
  "reasoning_synopsis": {
    "decision": "greenlight|revise|kill",
    "confidence": 0,
    "rationale": ["string","string","string"],
    "risks": ["string"],
    "next_actions": ["string"],
    "evidence": [{"claim":"string","source":"string"}]
  }
}

Input context:
${phaseContext(input)}

Rules:
- no markdown
- no commentary
- no placeholder text
- keep output specific to the provided project context
- if revision_guidance is present, prioritize it explicitly in deliverables and rationale`;

  return runJsonQuery(prompt, phase1PacketSchema, undefined, AGENT_PROFILES.ceo);
}

export async function generatePhase2Packet(input: PhaseGenerationInput): Promise<Phase2Packet> {
  const prompt = `You are CEO Agent. Generate STRICT JSON for Startup Machine PHASE 2 (Distribute).
Return ONLY valid JSON with this exact shape:
{
  "phase": 2,
  "summary": "string",
  "distribution_strategy": {
    "north_star_metric": "string",
    "channel_plan": [
      {"channel":"string","objective":"string","weekly_budget":"string"},
      {"channel":"string","objective":"string","weekly_budget":"string"}
    ]
  },
  "paid_acquisition": {
    "enabled": true,
    "budget_cap_per_day": 0,
    "target_audiences": ["string"],
    "creative_angles": ["string","string"],
    "kill_switch": "string"
  },
  "outreach": {
    "sequence_type": "string",
    "target_segments": ["string"],
    "daily_send_cap": 0
  },
  "lifecycle_email": {
    "journeys": ["string","string"],
    "send_window": "string"
  },
  "weekly_experiments": ["string","string","string"],
  "guardrails": ["string","string","string"],
  "reasoning_synopsis": {
    "decision": "greenlight|revise|kill",
    "confidence": 0,
    "rationale": ["string","string","string"],
    "risks": ["string"],
    "next_actions": ["string"],
    "evidence": [{"claim":"string","source":"string"}]
  }
}

Input context:
${phaseContext(input)}

Rules:
- paid_acquisition.budget_cap_per_day MUST honor permissions.ads_budget_cap
- if permissions.ads_enabled is false then paid_acquisition.enabled must be false
- no markdown
- no placeholder text
- if revision_guidance is present, explicitly reflect it in weekly_experiments and guardrails`;

  const parsed = await runJsonQuery(prompt, phase2PacketSchema, undefined, AGENT_PROFILES.ceo);

  const adsEnabled = Boolean(input.permissions.ads_enabled);
  const cap = Math.max(0, Number(input.permissions.ads_budget_cap ?? 0));
  return {
    ...parsed,
    paid_acquisition: {
      ...parsed.paid_acquisition,
      enabled: adsEnabled && parsed.paid_acquisition.enabled,
      budget_cap_per_day: cap,
    },
  };
}

export async function generatePhase3Packet(input: PhaseGenerationInput): Promise<Phase3Packet> {
  const prompt = `You are CEO Agent. Generate STRICT JSON for Startup Machine PHASE 3 (Go Live).
Return ONLY valid JSON with this exact shape:
{
  "phase": 3,
  "summary": "string",
  "architecture_review": {
    "runtime_mode": "shared|attached",
    "system_components": ["string","string","string"],
    "critical_dependencies": ["string","string"]
  },
  "build_plan": {
    "milestones": [
      {"name":"string","owner":"string","exit_criteria":"string"},
      {"name":"string","owner":"string","exit_criteria":"string"},
      {"name":"string","owner":"string","exit_criteria":"string"}
    ]
  },
  "qa_plan": {
    "test_suites": ["string","string","string"],
    "acceptance_gates": ["string","string","string"]
  },
  "launch_checklist": ["string","string","string","string"],
  "rollback_plan": {
    "triggers": ["string","string"],
    "steps": ["string","string","string"]
  },
  "merge_policy": {
    "review_required": true,
    "approvals_required": 2,
    "protected_branch": "main"
  },
  "operational_readiness": ["string","string","string"],
  "reasoning_synopsis": {
    "decision": "greenlight|revise|kill",
    "confidence": 0,
    "rationale": ["string","string","string"],
    "risks": ["string"],
    "next_actions": ["string"],
    "evidence": [{"claim":"string","source":"string"}]
  }
}

Input context:
${phaseContext(input)}

Rules:
- architecture_review.runtime_mode must match input runtime_mode
- merge_policy.protected_branch should be "main"
- no markdown
- no placeholder text
- if revision_guidance is present, reflect it in milestones and launch_checklist`;

  const parsed = await runJsonQuery(prompt, phase3PacketSchema, undefined, AGENT_PROFILES.ceo);
  return {
    ...parsed,
    architecture_review: {
      ...parsed.architecture_review,
      runtime_mode: input.runtime_mode,
    },
    merge_policy: {
      ...parsed.merge_policy,
      protected_branch: "main",
    },
  };
}

const landingHtmlSchema = z.object({
  html: z.string().min(200),
});

export async function generatePhase1LandingHtml(input: {
  project_name: string;
  domain: string | null;
  idea_description: string;
  brand_kit: { voice: string; color_palette: string[]; font_pairing: string; logo_prompt: string };
  landing_page: { headline: string; subheadline: string; primary_cta: string; sections: string[]; launch_notes: string[] };
  waitlist_fields: string[];
}): Promise<string> {
  const prompt = `You are the Greenlight Studio Design Agent. Generate a complete, production-ready HTML landing page.

Return STRICT JSON only:
{
  "html": "<full HTML document string>"
}

Requirements:
- Complete self-contained HTML document (all CSS in <style> tags, no external dependencies)
- Mobile-first responsive design with modern aesthetics
- Brand color palette: ${JSON.stringify(input.brand_kit.color_palette)}
- Font pairing: ${input.brand_kit.font_pairing}
- Brand voice: ${input.brand_kit.voice}
- Include a waitlist signup form with fields: ${input.waitlist_fields.join(', ')} (form action POST to /api/waitlist)
- Include Open Graph meta tags for social sharing
- Include semantic HTML and accessibility attributes (aria labels, alt text)
- Use smooth scroll, subtle animations, and professional typography
- Design should feel competitive with modern SaaS landing pages — not generic or template-like

Content to incorporate:
- Project: ${input.project_name}${input.domain ? ` (${input.domain})` : ''}
- Headline: ${input.landing_page.headline}
- Subheadline: ${input.landing_page.subheadline}
- Primary CTA: ${input.landing_page.primary_cta}
- Feature sections: ${JSON.stringify(input.landing_page.sections)}
- Launch notes: ${JSON.stringify(input.landing_page.launch_notes)}
- Idea: ${input.idea_description.slice(0, 400)}

Rules:
- No markdown code fences
- No commentary outside JSON
- The html field must contain the COMPLETE HTML document from <!doctype html> to </html>`;

  const result = await runJsonQuery(prompt, landingHtmlSchema, undefined, AGENT_PROFILES.design);
  return result.html;
}
