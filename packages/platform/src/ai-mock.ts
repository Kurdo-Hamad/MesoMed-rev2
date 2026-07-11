/**
 * Mock AiGateway (Phase 7). Dev/CI default — queue canned responses, or
 * arm `failing` to exercise the deterministic keyword-fallback path.
 */
import { AiGatewayError, type AiGateway } from "./ai.js";

export interface MockAiGateway extends AiGateway {
  readonly isMock: true;
  /** Responses returned in FIFO order; once exhausted, returns "". */
  queue: string[];
  /** While true, generate() rejects with AiGatewayError. */
  failing: boolean;
}

export function createMockAiGateway(initialQueue: string[] = []): MockAiGateway {
  const queue = [...initialQueue];
  return {
    isMock: true,
    queue,
    failing: false,
    generate(): Promise<string> {
      if (this.failing) {
        return Promise.reject(new AiGatewayError("mock AI gateway armed to fail"));
      }
      return Promise.resolve(this.queue.shift() ?? "");
    },
  };
}
