import { describe, expect, it } from "vitest";

import { createMockEmailChannel } from "./email-mock.js";
import { EmailSendError } from "./email.js";

describe("createMockEmailChannel", () => {
  it("records sent emails for test inspection", async () => {
    const channel = createMockEmailChannel();
    await channel.send({
      to: "doctor@example.com",
      subject: "Verify your email",
      text: "Click: https://example.com/verify?token=abc",
    });

    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]?.to).toBe("doctor@example.com");
    expect(channel.sent[0]?.text).toContain("token=abc");
  });

  it("throws EmailSendError when armed to fail, without recording", async () => {
    const channel = createMockEmailChannel();
    channel.failing = true;

    await expect(
      channel.send({ to: "x@example.com", subject: "s", text: "t" }),
    ).rejects.toBeInstanceOf(EmailSendError);
    expect(channel.sent).toEqual([]);
  });
});
