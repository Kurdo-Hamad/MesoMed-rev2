import { describe, expect, it } from "vitest";
import { devicePlatform } from "../lib/push-platform.js";

describe("devicePlatform", () => {
  it("maps ios and android to the wire enum", () => {
    expect(devicePlatform("ios")).toBe("ios");
    expect(devicePlatform("android")).toBe("android");
  });

  it("returns null for platforms with no push registration (caller skips)", () => {
    expect(devicePlatform("web")).toBeNull();
    expect(devicePlatform("windows")).toBeNull();
    expect(devicePlatform("macos")).toBeNull();
  });
});
