import { describe, expect, it } from "vitest";
import pino from "pino";
import { REDACT_PATHS } from "../src/kernel/redaction.js";

function loggerWithSink() {
  const lines: string[] = [];
  const stream = {
    write(chunk: string) {
      lines.push(chunk);
    },
  };
  const logger = pino({ redact: { paths: REDACT_PATHS, censor: "[REDACTED]" } }, stream);
  return { logger, lines };
}

describe("kernel PII redaction (MM-ARC-002 §6.5)", () => {
  it("folds a top-level phone number", () => {
    const { logger, lines } = loggerWithSink();
    logger.info({ phoneNumber: "+9647701234567" }, "otp sent");
    const entry = JSON.parse(lines[0]!);
    expect(entry.phoneNumber).toBe("[REDACTED]");
  });

  it("folds a phone number nested inside an err object", () => {
    const { logger, lines } = loggerWithSink();
    logger.warn({ err: { phoneNumber: "+9647701234567", message: "boom" } }, "whatsapp failed");
    const entry = JSON.parse(lines[0]!);
    expect(entry.err.phoneNumber).toBe("[REDACTED]");
    expect(entry.err.message).toBe("boom");
  });

  it("folds a name and normalizedPhone nested two levels deep", () => {
    const { logger, lines } = loggerWithSink();
    logger.info(
      { context: { patient: { fullName: "Jane Doe", normalizedPhone: "+9647709999999" } } },
      "context loaded",
    );
    const entry = JSON.parse(lines[0]!);
    expect(entry.context.patient.fullName).toBe("[REDACTED]");
    expect(entry.context.patient.normalizedPhone).toBe("[REDACTED]");
  });

  it("does not touch unrelated fields", () => {
    const { logger, lines } = loggerWithSink();
    logger.info({ appointmentId: "abc-123", status: "sent" }, "notification sent");
    const entry = JSON.parse(lines[0]!);
    expect(entry.appointmentId).toBe("abc-123");
    expect(entry.status).toBe("sent");
  });
});
