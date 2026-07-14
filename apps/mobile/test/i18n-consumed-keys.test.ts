import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { APPOINTMENT_STATUSES } from "@mesomed/contracts/booking";
import { MEDICATION_SOURCES, PRESCRIPTION_STATUSES } from "@mesomed/contracts/clinical";
import { locales } from "@mesomed/i18n";
import { describe, expect, it } from "vitest";

// MM-QA-003 F-10: the catalog parity test proves en/ar/ckb agree with each
// other, but nothing tied the keys the mobile app CONSUMES to the catalogs —
// a t("typo") against a key absent from all three passed CI and failed only
// at runtime. This suite statically extracts every consumed key from
// apps/mobile source and asserts each resolves to a string leaf in all
// three catalogs.
//
// Extraction contract (violations FAIL the suite instead of being skipped,
// so unextractable patterns can never silently escape the guardrail):
// - every useTranslations() call takes a string-literal namespace and is
//   bound as `const <name> = useTranslations("...")`;
// - a binding name maps to exactly one namespace per file;
// - a bound t is called with a string literal or a template of the form
//   `prefix_${...}` whose prefix is registered in DYNAMIC_KEY_VALUES
//   against the contracts enum that types the interpolated value.

// Template keys expand against the SAME contracts enums that type the
// interpolated value, so a new enum member fails here until all three
// catalogs carry its key.
const DYNAMIC_KEY_VALUES: Record<string, readonly string[]> = {
  status_: APPOINTMENT_STATUSES,
  source_: MEDICATION_SOURCES,
  prescription_: PRESCRIPTION_STATUSES,
};

const SOURCE_DIRS = ["app", "components", "lib"];

const BINDING_RE = /const\s+(\w+)\s*=\s*useTranslations\(\s*"([^"]+)"\s*\)/g;

interface FileExtraction {
  keys: string[];
  problems: string[];
}

function countMatches(source: string, re: RegExp): number {
  return [...source.matchAll(re)].length;
}

function extractConsumedKeys(source: string, file: string): FileExtraction {
  const keys: string[] = [];
  const problems: string[] = [];

  const nonLiteralNamespaces = countMatches(source, /useTranslations\(\s*(?!")/g);
  if (nonLiteralNamespaces > 0) {
    problems.push(`${file}: useTranslations() called with a non-literal namespace`);
  }

  const bindings = [...source.matchAll(BINDING_RE)];
  if (bindings.length !== countMatches(source, /useTranslations\(\s*"/g)) {
    problems.push(
      `${file}: a useTranslations("...") call is not bound via const — extraction cannot attribute its keys`,
    );
  }

  const namespaceByVar = new Map<string, string>();
  for (const match of bindings) {
    const name = match[1];
    const namespace = match[2];
    if (!name || !namespace) continue;
    const existing = namespaceByVar.get(name);
    if (existing !== undefined && existing !== namespace) {
      problems.push(
        `${file}: "${name}" is bound to both "${existing}" and "${namespace}" — rename one binding so extraction stays unambiguous`,
      );
      continue;
    }
    namespaceByVar.set(name, namespace);
  }

  for (const [name, namespace] of namespaceByVar) {
    const callHead = `(?<![\\w.$])${name}(?:\\.(?:rich|raw|markup))?\\(\\s*`;
    if (countMatches(source, new RegExp(`${callHead}(?!["\`])`, "g")) > 0) {
      problems.push(`${file}: ${name}(...) called with a non-literal key`);
    }
    const literalCall = new RegExp(`${callHead}(?:"([^"]*)"|\`([^\`]*)\`)`, "g");
    for (const match of source.matchAll(literalCall)) {
      const literal = match[1];
      const template = match[2];
      if (literal !== undefined) {
        keys.push(`${namespace}.${literal}`);
        continue;
      }
      if (template === undefined) continue;
      if (!template.includes("${")) {
        keys.push(`${namespace}.${template}`);
        continue;
      }
      const dynamic = /^([\w.]*?_)\$\{[^}]+\}$/.exec(template);
      const prefix = dynamic?.[1];
      const values = prefix ? DYNAMIC_KEY_VALUES[prefix] : undefined;
      if (!prefix || !values) {
        problems.push(
          `${file}: template key \`${template}\` has no entry in DYNAMIC_KEY_VALUES — register the contracts enum that types it`,
        );
        continue;
      }
      for (const value of values) keys.push(`${namespace}.${prefix}${value}`);
    }
  }

  return { keys, problems };
}

function resolveKey(catalog: unknown, path: string): boolean {
  let node: unknown = catalog;
  for (const segment of path.split(".")) {
    if (typeof node !== "object" || node === null) return false;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === "string";
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("mobile consumed i18n keys (MM-QA-003 F-10)", () => {
  const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const consumers = new Map<string, string[]>();
  const problems: string[] = [];
  for (const file of SOURCE_DIRS.flatMap((dir) => sourceFiles(join(mobileRoot, dir)))) {
    const label = relative(mobileRoot, file);
    const extraction = extractConsumedKeys(readFileSync(file, "utf8"), label);
    problems.push(...extraction.problems);
    for (const key of extraction.keys) {
      consumers.set(key, [...(consumers.get(key) ?? []), label]);
    }
  }

  it("extraction hit no unattributable or unregistered patterns", () => {
    expect(problems).toEqual([]);
  });

  it("extraction is alive, not inert (151 keys at authoring)", () => {
    // Guards the R9 inert-guardrail class: if the regexes drift from how the
    // code actually consumes translations, the sweep collapses toward zero
    // and this floor fails loudly instead of the suite passing vacuously.
    expect(consumers.size).toBeGreaterThan(100);
  });

  it("every consumed key exists in en, ar and ckb", () => {
    const missing: string[] = [];
    for (const [key, files] of consumers) {
      for (const [locale, catalog] of Object.entries(locales)) {
        if (!resolveKey(catalog, key)) {
          missing.push(`${key} missing in ${locale} (used by ${files.join(", ")})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("extraction guardrail fires (meta)", () => {
  it("attributes literal keys through the binding namespace", () => {
    const { keys, problems } = extractConsumedKeys(
      'const tX = useTranslations("web.a");\nreturn tX("b");',
      "fixture.tsx",
    );
    expect(problems).toEqual([]);
    expect(keys).toEqual(["web.a.b"]);
  });

  it("expands a registered dynamic template against its contracts enum", () => {
    const { keys, problems } = extractConsumedKeys(
      'const t = useTranslations("web.d");\nreturn t(`status_${row.status}`);',
      "fixture.tsx",
    );
    expect(problems).toEqual([]);
    expect(keys).toEqual(APPOINTMENT_STATUSES.map((status) => `web.d.status_${status}`));
  });

  it("flags an unregistered template instead of skipping it", () => {
    const { keys, problems } = extractConsumedKeys(
      'const t = useTranslations("web.d");\nreturn t(`tier_${row.tier}`);',
      "fixture.tsx",
    );
    expect(keys).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("DYNAMIC_KEY_VALUES");
  });

  it("flags non-literal namespaces, unbound calls, conflicting bindings and non-literal keys", () => {
    expect(extractConsumedKeys("useTranslations(ns);", "f.tsx").problems).toHaveLength(1);
    expect(extractConsumedKeys('useTranslations("a")("b");', "f.tsx").problems).toHaveLength(1);
    expect(
      extractConsumedKeys(
        'const t = useTranslations("a");\nconst t = useTranslations("b");\nt("k");',
        "f.tsx",
      ).problems,
    ).toHaveLength(1);
    expect(
      extractConsumedKeys('const t = useTranslations("a");\nt(key);', "f.tsx").problems,
    ).toHaveLength(1);
  });

  it("a key absent from a catalog does not resolve", () => {
    const catalog = { web: { a: { present: "x" } } };
    expect(resolveKey(catalog, "web.a.present")).toBe(true);
    expect(resolveKey(catalog, "web.a.absent")).toBe(false);
    expect(resolveKey(catalog, "web.a")).toBe(false);
  });
});
