/**
 * Anthropic AiGateway adapter (MM-PLAN-001 §5 Phase 7): the real triage
 * engine, via the Vercel AI SDK. Vendor SDK import isolated to this file
 * (§3.8) — the AI module only ever imports the `AiGateway` interface.
 *
 * Model is Haiku-tier: triage is a closed-vocabulary classification task
 * (map symptom text to at most 3 specialty slugs), not open-ended
 * generation — cost/latency favor the cheapest capable tier.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { AiGatewayError, type AiGateway, type AiGatewayInput } from "./ai.js";

export const DEFAULT_ANTHROPIC_TRIAGE_MODEL = "claude-haiku-4-5";

export interface AnthropicAiGatewayOptions {
  apiKey: string;
  model?: string;
}

export function createAnthropicAiGateway(options: AnthropicAiGatewayOptions): AiGateway {
  const anthropic = createAnthropic({ apiKey: options.apiKey });
  const model = anthropic(options.model ?? DEFAULT_ANTHROPIC_TRIAGE_MODEL);

  return {
    async generate(input: AiGatewayInput): Promise<string> {
      try {
        const result = await generateText({
          model,
          system: input.system,
          prompt: input.prompt,
          maxOutputTokens: input.maxTokens,
          abortSignal: AbortSignal.timeout(input.timeoutMs),
        });
        return result.text;
      } catch (error) {
        throw new AiGatewayError("Anthropic generate failed", { cause: error });
      }
    },
  };
}
