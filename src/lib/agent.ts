import { query } from "@anthropic-ai/claude-agent-sdk";
import { requireEnv } from "@/lib/env";
import { packetSchema, reasoningSynopsisSchema, type OnboardingInput, type Packet } from "@/types/domain";
import { z } from "zod";
import { withRetry } from "@/lib/retry";

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
  return { ANTHROPIC_API_KEY: requireEnv("ANTHROPIC_API_KEY") };
}

async function runTextQuery(prompt: string) {
  return withRetry(async () => {
    const stream = query({
      prompt,
      options: {
        model: "sonnet",
        env: sdkEnv(),
      },
    });

    let raw = "";
    for await (const message of stream) {
      if (message.type !== "assistant") continue;
      for (const block of message.message.content) {
        if (block.type === "text") raw += block.text;
      }
    }

    if (!raw.trim()) throw new Error("Agent returned empty response");
    return raw.trim();
  }, { retries: 1, baseDelayMs: 600 });
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

  const raw = await runTextQuery(prompt);
  return researchSchema.parse(JSON.parse(raw));
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

  const raw = await runTextQuery(prompt);
  const parsed = JSON.parse(raw);
  const synopsis = reasoningSynopsisSchema.parse(parsed.reasoning_synopsis);
  return packetSchema.parse({ ...parsed, reasoning_synopsis: synopsis });
}
