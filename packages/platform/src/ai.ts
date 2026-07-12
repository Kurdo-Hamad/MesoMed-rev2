/**
 * AiGateway adapter interface (MM-PLAN-001 §3.8, §5 Phase 7): a single
 * text-completion call to an LLM provider. The AI module's triage service
 * is the only consumer — it supplies the full prompt and a timeout, and
 * treats any failure (including a timeout) as "no model available",
 * falling back to the deterministic keyword engine.
 */
export interface AiGatewayInput {
  system: string;
  prompt: string;
  maxTokens: number;
  /** Abort the call after this many milliseconds. */
  timeoutMs: number;
}

export class AiGatewayError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiGatewayError";
  }
}

export interface AiGateway {
  /** Generate text. Rejects with AiGatewayError on failure or timeout. */
  generate(input: AiGatewayInput): Promise<string>;
}
