import { describe, expect, it } from "vitest";
import { AiGatewayError } from "./ai.js";
import { createMockAiGateway } from "./ai-mock.js";

describe("createMockAiGateway", () => {
  it("returns queued responses in FIFO order, then empty string", async () => {
    const gateway = createMockAiGateway(["first", "second"]);
    const input = { system: "s", prompt: "p", maxTokens: 10, timeoutMs: 100 };

    await expect(gateway.generate(input)).resolves.toBe("first");
    await expect(gateway.generate(input)).resolves.toBe("second");
    await expect(gateway.generate(input)).resolves.toBe("");
  });

  it("rejects with AiGatewayError when armed to fail", async () => {
    const gateway = createMockAiGateway();
    gateway.failing = true;

    await expect(
      gateway.generate({ system: "s", prompt: "p", maxTokens: 10, timeoutMs: 100 }),
    ).rejects.toBeInstanceOf(AiGatewayError);
  });
});
