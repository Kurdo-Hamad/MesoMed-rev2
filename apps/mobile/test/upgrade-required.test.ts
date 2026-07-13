import { describe, expect, it } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { ErrorCode } from "@mesomed/contracts/errors";
import type { AppRouter } from "@mesomed/api/router";
import {
  getSnapshot,
  isUpgradeRequiredError,
  setUpgradeRequired,
  subscribe,
} from "../lib/upgrade-required.js";

function trpcError(appCode: ErrorCode): TRPCClientError<AppRouter> {
  return new TRPCClientError("boom", {
    result: {
      error: {
        message: "boom",
        code: -32603,
        data: { appCode, code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
      },
    },
  });
}

function trpcErrorWithNoData(): TRPCClientError<AppRouter> {
  return new TRPCClientError("boom", {});
}

describe("isUpgradeRequiredError", () => {
  it("is true for a tRPC error carrying appCode UPGRADE_REQUIRED", () => {
    expect(isUpgradeRequiredError(trpcError(ErrorCode.UPGRADE_REQUIRED))).toBe(true);
  });

  it("is false for any other appCode", () => {
    expect(isUpgradeRequiredError(trpcError(ErrorCode.FORBIDDEN))).toBe(false);
  });

  it("is false for a tRPC error with no data, and for non-tRPC errors", () => {
    expect(isUpgradeRequiredError(trpcErrorWithNoData())).toBe(false);
    expect(isUpgradeRequiredError(new Error("plain"))).toBe(false);
    expect(isUpgradeRequiredError("not an error")).toBe(false);
  });
});

describe("upgrade-required store", () => {
  it("notifies subscribers only on an actual value change", () => {
    setUpgradeRequired(false);
    let notifications = 0;
    const unsubscribe = subscribe(() => {
      notifications += 1;
    });

    setUpgradeRequired(false); // no-op: already false
    expect(notifications).toBe(0);

    setUpgradeRequired(true);
    expect(notifications).toBe(1);
    expect(getSnapshot()).toBe(true);

    setUpgradeRequired(true); // no-op: already true
    expect(notifications).toBe(1);

    unsubscribe();
    setUpgradeRequired(false);
    expect(notifications).toBe(1); // unsubscribed — no further notification
    expect(getSnapshot()).toBe(false);
  });
});
