import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ErrorCode } from "@mesomed/contracts/errors";
import { classifyBookingError } from "../lib/booking-error";

// MM-QA-004 F-05 regression guard: the web booking screen classified
// booking errors by regex over error.message — a convention #11 violation
// (messages are non-contractual; clients switch on data.appCode, never
// message text). This suite proves classification is driven by appCode
// alone and fails if any web code path reads error.message again.

describe("booking error classification switches on appCode (convention #11)", () => {
  it("classifies SLOT_UNAVAILABLE as slotTaken", () => {
    expect(classifyBookingError({ data: { appCode: ErrorCode.SLOT_UNAVAILABLE } })).toBe(
      "slotTaken",
    );
  });

  it("classifies any other appCode — or a missing one — as failed", () => {
    expect(classifyBookingError({ data: { appCode: ErrorCode.VALIDATION } })).toBe("failed");
    expect(classifyBookingError({ data: undefined })).toBe("failed");
    expect(classifyBookingError({})).toBe("failed");
  });

  it("ignores message text that fooled the old regex in both directions", () => {
    // Old regex: /conflict|taken|SLOT/i over the message. Neither a
    // slot-sounding message without the code nor a code without such a
    // message may change the outcome.
    const misleading = Object.assign(new Error("This slot is already booked"), {
      data: { appCode: ErrorCode.VALIDATION },
    });
    expect(classifyBookingError(misleading)).toBe("failed");

    const reworded = Object.assign(new Error("Erreur interne"), {
      data: { appCode: ErrorCode.SLOT_UNAVAILABLE },
    });
    expect(classifyBookingError(reworded)).toBe("slotTaken");
  });

  it("never reads error.message (throwing-getter tripwire)", () => {
    const tripwire = (appCode: string | undefined) => {
      const error: { data: { appCode: string | undefined }; message?: string } = {
        data: { appCode },
      };
      Object.defineProperty(error, "message", {
        get(): string {
          throw new Error("classification read error.message (convention #11, MM-QA-004 F-05)");
        },
      });
      return error;
    };
    expect(classifyBookingError(tripwire(ErrorCode.SLOT_UNAVAILABLE))).toBe("slotTaken");
    expect(classifyBookingError(tripwire(undefined))).toBe("failed");
  });
});

// Static half (pattern: test/no-local-status-actions.test.ts): no web
// source may branch on error-message text, so the fix cannot be re-inlined
// or replicated elsewhere without failing here.

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIRS = ["app", "components", "lib"];

const FORBIDDEN_PATTERNS: Array<{ re: RegExp; why: string }> = [
  {
    re: /\.message\.(includes|startsWith|match|indexOf)\(/,
    why: "string-matching over an error message (the MM-QA-004 F-05 sweep pattern)",
  },
  {
    re: /\.message\s*===/,
    why: "equality-branching on an error message",
  },
  {
    re: /\.test\(\s*\w*[Mm]essage/,
    why: "regex-testing an error message (the original F-05 shape)",
  },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("no web code path classifies errors by message text (F-05)", () => {
  const files = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(WEB_ROOT, dir)));

  it("scans a real source tree", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("finds no message-parsing site anywhere in web source", () => {
    const violations = files.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return FORBIDDEN_PATTERNS.filter((pattern) => pattern.re.test(source)).map(
        (pattern) => `${relative(WEB_ROOT, file)}: matches ${pattern.re} (${pattern.why})`,
      );
    });
    expect(violations).toEqual([]);
  });

  it("the booking page classifies via the shared appCode classifier", () => {
    const page = readFileSync(
      join(WEB_ROOT, "app", "[locale]", "book", "[slug]", "page.tsx"),
      "utf8",
    );
    expect(page).toContain("classifyBookingError(book.error)");
    expect(page).not.toContain("book.error.message");
  });
});
