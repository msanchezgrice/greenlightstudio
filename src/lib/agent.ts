import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync } from "node:fs";
import path from "node:path";
import { requireEnv } from "@/lib/env";
import { packetSchema, type OnboardingInput, type Packet } from "@/types/domain";
import {
  phase1PacketSchema,
  phase2PacketSchema,
  phase3PacketSchema,
  type Phase1Packet,
  type Phase2Packet,
  type Phase3Packet,
} from "@/types/phase-packets";
import { z } from "zod";

const AGENT_QUERY_TIMEOUT_MS = 55_000;
const AGENT_QUERY_MAX_TURNS = 12;

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

function sdkEnv() {
  return { ...process.env, ANTHROPIC_API_KEY: requireEnv("ANTHROPIC_API_KEY") };
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
  name: "structured_bypass" | "structured_default" | "text_default";
  useOutputFormat: boolean;
  bypassPermissions: boolean;
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

function isRetryableAgentFailure(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("timed out") ||
    lower.includes("without result message") ||
    lower.includes("empty response") ||
    lower.includes("structured output retries")
  );
}

async function executeQueryAttempt<T>(prompt: string, schema: z.ZodType<T>, profile: QueryProfile) {
  const executablePath = resolveClaudeCodeExecutablePath();
  const stream = query({
    prompt,
    options: {
      model: "sonnet",
      env: sdkEnv(),
      pathToClaudeCodeExecutable: executablePath,
      maxTurns: AGENT_QUERY_MAX_TURNS,
      includePartialMessages: true,
      ...(profile.useOutputFormat
        ? {
            outputFormat: {
              type: "json_schema" as const,
              schema: z.toJSONSchema(schema),
            },
          }
        : {}),
      ...(profile.bypassPermissions
        ? {
            permissionMode: "bypassPermissions" as const,
            allowDangerouslySkipPermissions: true,
          }
        : {}),
    },
  });

  let raw = "";
  let streamedRaw = "";
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

  if (timedOut) {
    throw new Error(`Agent query timed out after ${Math.round(AGENT_QUERY_TIMEOUT_MS / 1000)}s | ${describeQueryState(state)}`);
  }

  if (!state.sawResult) {
    throw new Error(`Agent stream ended without result message | ${describeQueryState(state)}`);
  }

  if (typeof structuredOutput !== "undefined") {
    return schema.parse(structuredOutput);
  }

  const finalText = raw.trim() || streamedRaw.trim() || resultText.trim();
  if (resultError && !finalText) throw new Error(resultError);
  if (!finalText) {
    throw new Error(`Agent returned empty response | ${describeQueryState(state)}`);
  }
  return schema.parse(parseAgentJson<T>(finalText));
}

async function runJsonQuery<T>(prompt: string, schema: z.ZodType<T>) {
  const profiles: QueryProfile[] = [
    { name: "structured_bypass", useOutputFormat: true, bypassPermissions: true },
    { name: "structured_default", useOutputFormat: true, bypassPermissions: false },
    { name: "text_default", useOutputFormat: false, bypassPermissions: false },
  ];

  const errors: string[] = [];
  for (const profile of profiles) {
    try {
      return await executeQueryAttempt(prompt, schema, profile);
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

async function runResearchAgent(input: OnboardingInput) {
  const prompt = `You are Research Agent. Return STRICT JSON only.
Input:\n${JSON.stringify({ domain: input.domain, idea_description: input.idea_description })}

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

  return runJsonQuery(prompt, researchSchema);
}

export async function generatePhase0Packet(input: OnboardingInput): Promise<Packet> {
  const research = await runResearchAgent(input);

  const prompt = `You are CEO Agent. Generate STRICT JSON for a Phase 0 packet.
Use this onboarding input:\n${JSON.stringify(input)}
Use this research brief:\n${JSON.stringify(research)}

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

  return runJsonQuery(prompt, packetSchema);
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
    },
    null,
    2,
  );
}

export async function generatePhase1Packet(input: PhaseGenerationInput): Promise<Phase1Packet> {
  const prompt = `You are CEO Agent. Generate STRICT JSON for Greenlight Studio PHASE 1 (Validate).
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
- keep output specific to the provided project context`;

  return runJsonQuery(prompt, phase1PacketSchema);
}

export async function generatePhase2Packet(input: PhaseGenerationInput): Promise<Phase2Packet> {
  const prompt = `You are CEO Agent. Generate STRICT JSON for Greenlight Studio PHASE 2 (Distribute).
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
- no placeholder text`;

  const parsed = await runJsonQuery(prompt, phase2PacketSchema);

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
  const prompt = `You are CEO Agent. Generate STRICT JSON for Greenlight Studio PHASE 3 (Go Live).
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
- no placeholder text`;

  const parsed = await runJsonQuery(prompt, phase3PacketSchema);
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
