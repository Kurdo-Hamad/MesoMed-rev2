import { describe, expect, it } from "vitest";

import { createMockOtpChannel } from "./otp-mock.js";
import { OtpSendError } from "./otp.js";

describe("createMockOtpChannel", () => {
  it("reports its channel kind", () => {
    expect(createMockOtpChannel("whatsapp").channel).toBe("whatsapp");
    expect(createMockOtpChannel("sms").channel).toBe("sms");
  });

  it("records sent messages for test inspection", async () => {
    const channel = createMockOtpChannel("whatsapp");
    await channel.send({ to: "+9647701234567", code: "123456", locale: "ckb" });

    expect(channel.sent).toEqual([{ to: "+9647701234567", code: "123456", locale: "ckb" }]);
  });

  it("throws OtpSendError when armed to fail, without recording the message", async () => {
    const channel = createMockOtpChannel("whatsapp");
    channel.failing = true;

    await expect(
      channel.send({ to: "+9647701234567", code: "123456", locale: "en" }),
    ).rejects.toBeInstanceOf(OtpSendError);
    expect(channel.sent).toEqual([]);
  });

  it("carries the failing channel kind on the error", async () => {
    const channel = createMockOtpChannel("sms");
    channel.failing = true;

    await expect(
      channel.send({ to: "+9647701234567", code: "1", locale: "ar" }),
    ).rejects.toMatchObject({
      channel: "sms",
    });
  });

  it("resumes sending when disarmed", async () => {
    const channel = createMockOtpChannel("whatsapp");
    channel.failing = true;
    await expect(channel.send({ to: "+1", code: "1", locale: "en" })).rejects.toThrow();

    channel.failing = false;
    await channel.send({ to: "+9647701234567", code: "654321", locale: "en" });
    expect(channel.sent).toHaveLength(1);
  });
});
