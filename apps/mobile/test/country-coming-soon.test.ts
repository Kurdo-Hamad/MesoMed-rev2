import { describe, expect, it } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { ErrorCode } from "@mesomed/contracts/errors";
import type { AppRouter } from "@mesomed/api/router";
import {
  getSnapshot,
  isCountryComingSoonError,
  setCountryComingSoon,
  subscribe,
} from "../lib/country-coming-soon.js";

function trpcError(appCode: ErrorCode): TRPCClientError<AppRouter> {
  return new TRPCClientError("boom", {
    result: {
      error: {
        message: "boom",
        code: -32603,
        data: { appCode, code: "PRECONDITION_FAILED", httpStatus: 412 },
      },
    },
  });
}

describe("isCountryComingSoonError", () => {
  it("is true for a tRPC error carrying appCode COUNTRY_COMING_SOON", () => {
    expect(isCountryComingSoonError(trpcError(ErrorCode.COUNTRY_COMING_SOON))).toBe(true);
  });

  it("is false for any other appCode, and for non-tRPC errors", () => {
    expect(isCountryComingSoonError(trpcError(ErrorCode.UPGRADE_REQUIRED))).toBe(false);
    expect(isCountryComingSoonError(new Error("plain"))).toBe(false);
  });
});

describe("country-coming-soon store", () => {
  it("notifies subscribers only on an actual value change", () => {
    setCountryComingSoon(false);
    let notifications = 0;
    const unsubscribe = subscribe(() => {
      notifications += 1;
    });

    setCountryComingSoon(false);
    expect(notifications).toBe(0);

    setCountryComingSoon(true);
    expect(notifications).toBe(1);
    expect(getSnapshot()).toBe(true);

    unsubscribe();
    setCountryComingSoon(false);
    expect(notifications).toBe(1);
  });
});
