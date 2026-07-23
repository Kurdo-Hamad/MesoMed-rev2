import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// MM-QA-003 F-08 class (caught in the owner's first on-device session): a
// <Link asChild> wrapping a plain <View> is silently dead — expo-router
// injects onPress into the child, but View has no press handling, so the
// tile renders fine and navigates nowhere. The RN test posture can't render
// screens, so this suite statically scans mobile sources and fails on the
// pattern. The child must be a pressable component (Pressable et al.).
//
// Extraction contract (violations FAIL the suite instead of being skipped,
// so unclassifiable patterns can never silently escape the guardrail):
// every non-self-closing <Link ... asChild> must have a direct JSX element
// as its first child — an expression or text child is flagged as a problem,
// not ignored.

const SOURCE_DIRS = ["app", "components", "lib"];

interface LinkScan {
  /** Link-asChild sites whose direct child is a plain <View>. */
  violations: string[];
  /** Sites the scanner could not classify — these fail the suite too. */
  problems: string[];
  /** Total <Link ... asChild> sites seen (aliveness floor). */
  sites: number;
}

/** Index just past the `>` that closes the opening tag starting at `start`
 * (which points at `<`). Tracks `{}` depth so `>` inside attribute
 * expressions (arrow functions, templates) is ignored. Returns -1 if the
 * tag never closes. */
function openingTagEnd(source: string, start: number): number {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return i + 1;
  }
  return -1;
}

/** Index of the first child character after an opening tag, skipping
 * whitespace and brace-wrapped JSX comment blocks. */
function firstChildIndex(source: string, from: number): number {
  let i = from;
  for (;;) {
    while (i < source.length && /\s/.test(source[i] ?? "")) i++;
    if (source.startsWith("{/*", i)) {
      const close = source.indexOf("*/}", i);
      if (close === -1) return i;
      i = close + 3;
      continue;
    }
    return i;
  }
}

function scanLinkAsChild(source: string, file: string): LinkScan {
  const violations: string[] = [];
  const problems: string[] = [];
  let sites = 0;

  for (const match of source.matchAll(/<Link\b/g)) {
    const start = match.index;
    const tagEnd = openingTagEnd(source, start);
    if (tagEnd === -1) {
      problems.push(`${file}: <Link> opening tag never closes — scanner cannot classify it`);
      continue;
    }
    const tag = source.slice(start, tagEnd);
    if (!/\basChild\b/.test(tag)) continue;
    sites++;
    if (tag.endsWith("/>")) continue;

    const line = source.slice(0, start).split("\n").length;
    const at = `${file}:${line}`;
    const childStart = firstChildIndex(source, tagEnd);
    const child = /^<([A-Za-z][\w.]*)/.exec(source.slice(childStart, childStart + 80));
    if (!child) {
      problems.push(
        `${at}: child of <Link asChild> is not a direct JSX element — scanner cannot classify it`,
      );
      continue;
    }
    // Matches View and namespaced Views (Animated.View forwards its props
    // to a plain View, dropping the injected onPress just the same).
    if (/^(?:[\w]+\.)*View$/.test(child[1] ?? "")) {
      violations.push(`${at}: <Link asChild> wraps a plain <View> — taps are silently dead`);
    }
  }

  return { violations, problems, sites };
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("no <Link asChild> wrapping a plain <View> (MM-QA-003 F-08 class)", () => {
  const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const violations: string[] = [];
  const problems: string[] = [];
  let sites = 0;
  for (const file of SOURCE_DIRS.flatMap((dir) => sourceFiles(join(mobileRoot, dir)))) {
    const scan = scanLinkAsChild(readFileSync(file, "utf8"), relative(mobileRoot, file));
    violations.push(...scan.violations);
    problems.push(...scan.problems);
    sites += scan.sites;
  }

  it("scanner hit no unclassifiable Link-asChild children", () => {
    expect(problems).toEqual([]);
  });

  it("scanner is alive, not inert (13 sites at authoring)", () => {
    // Guards the R9 inert-guardrail class: if the scan drifts from how the
    // code actually renders links, the site count collapses toward zero and
    // this floor fails loudly instead of the suite passing vacuously.
    expect(sites).toBeGreaterThan(8);
  });

  it("every <Link asChild> child handles presses", () => {
    expect(violations).toEqual([]);
  });
});

describe("scanner guardrail fires (meta)", () => {
  it("flags a Link asChild directly wrapping a View", () => {
    const scan = scanLinkAsChild(
      '<Link href={`/d/${slug}`} asChild>\n  <View className="p-4">\n    <Text>x</Text>\n  </View>\n</Link>',
      "fixture.tsx",
    );
    expect(scan.sites).toBe(1);
    expect(scan.problems).toEqual([]);
    expect(scan.violations).toHaveLength(1);
    expect(scan.violations[0]).toContain("fixture.tsx:1");
  });

  it("accepts a Pressable child and ignores Links without asChild", () => {
    const scan = scanLinkAsChild(
      '<Link href="/a" asChild>\n  <Pressable className="p-4" />\n</Link>\n<Link href="/b" className="text-brand">text</Link>',
      "fixture.tsx",
    );
    expect(scan.sites).toBe(1);
    expect(scan.problems).toEqual([]);
    expect(scan.violations).toEqual([]);
  });

  it("sees through multiline tags, comment children and expression attributes", () => {
    const scan = scanLinkAsChild(
      '<Link\n  href={{ pathname: "/x", params: { a: () => 1 > 0 } }}\n  asChild\n>\n  {/* note */}\n  <View>\n    <Text>x</Text>\n  </View>\n</Link>',
      "fixture.tsx",
    );
    expect(scan.problems).toEqual([]);
    expect(scan.violations).toHaveLength(1);
  });

  it("flags a namespaced View (Animated.View) too", () => {
    const scan = scanLinkAsChild(
      '<Link href="/a" asChild>\n  <Animated.View entering={FadeIn}>\n    <Text>x</Text>\n  </Animated.View>\n</Link>',
      "fixture.tsx",
    );
    expect(scan.problems).toEqual([]);
    expect(scan.violations).toHaveLength(1);
  });

  it("flags a non-element child instead of skipping it", () => {
    const scan = scanLinkAsChild("<Link href='/a' asChild>\n  {children}\n</Link>", "fixture.tsx");
    expect(scan.violations).toEqual([]);
    expect(scan.problems).toHaveLength(1);
    expect(scan.problems[0]).toContain("cannot classify");
  });

  it("skips self-closing Links", () => {
    const scan = scanLinkAsChild('<Link href="/a" asChild />', "fixture.tsx");
    expect(scan.sites).toBe(1);
    expect(scan.problems).toEqual([]);
    expect(scan.violations).toEqual([]);
  });
});
