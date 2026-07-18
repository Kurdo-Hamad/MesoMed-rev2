import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { APPOINTMENT_ACTIONS, APPOINTMENT_STATUSES } from "@mesomed/contracts/booking";
import { MEDICATION_SOURCES, PRESCRIPTION_STATUSES } from "@mesomed/contracts/clinical";
import { LOCALES } from "@mesomed/contracts/i18n";
import { PROVIDER_TYPES } from "@mesomed/contracts/identity";
import { ROLES } from "@mesomed/contracts/roles";
import { locales } from "@mesomed/i18n";
import { describe, expect, it } from "vitest";

// MM-QA-004 F-24: port of the mobile consumed-keys guardrail
// (apps/mobile/test/i18n-consumed-keys.test.ts, MM-QA-003 F-10) to web.
// The catalog parity test proves en/ar/ckb agree with each other, but
// nothing tied the keys the web app CONSUMES to the catalogs — a t("typo")
// against a key absent from all three passed CI and failed only at runtime.
// This suite statically extracts every consumed key from apps/web source
// and asserts each resolves to a string leaf in all three catalogs.
//
// Extraction contract (violations FAIL the suite instead of being skipped,
// so unextractable patterns can never silently escape the guardrail):
// - every translator is bound with a string-literal namespace, as one of
//   `const <name> = useTranslations("...")` (client components),
//   `const <name> = await getTranslations("...")` (server components), or
//   `const <name> = await getTranslations({ locale, namespace: "..." })`;
// - a binding name maps to exactly one namespace per file;
// - a bound t is called with a string literal, a template of the form
//   `prefix_${...}` whose prefix is registered in DYNAMIC_KEY_VALUES
//   against the contracts enum that types the interpolated value, or a
//   template of the form `${section}Suffix` expanded against the file's
//   own `const SECTIONS = [...]` list (the legal pages' pattern).

// Template keys expand against the SAME contracts enums that type the
// interpolated value, so a new enum member fails here until all three
// catalogs carry its key.
const DYNAMIC_KEY_VALUES: Record<string, readonly string[]> = {
  status_: APPOINTMENT_STATUSES,
  action_: APPOINTMENT_ACTIONS,
  source_: MEDICATION_SOURCES,
  prescription_: PRESCRIPTION_STATUSES,
  role_: ROLES,
  providerType_: PROVIDER_TYPES,
};

// The locale switcher renders `t(locale)` — the WHOLE key is dynamic, typed
// by the contracts LOCALES enum. Registered per file + binding name; a
// non-literal key anywhere else still fails the suite.
const DYNAMIC_WHOLE_KEYS: Record<string, Record<string, readonly string[]>> = {
  "components/locale-switcher.tsx": { t: LOCALES },
};

const SOURCE_DIRS = ["app", "components", "lib"];

const BINDING_RES = [
  /const\s+(\w+)\s*=\s*useTranslations\(\s*"([^"]+)"\s*\)/g,
  /const\s+(\w+)\s*=\s*await\s+getTranslations\(\s*"([^"]+)"\s*\)/g,
  /const\s+(\w+)\s*=\s*await\s+getTranslations\(\s*\{[^{}]*namespace:\s*"([^"]+)"[^{}]*\}\s*\)/g,
];

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

  if (countMatches(source, /useTranslations\(\s*(?!")/g) > 0) {
    problems.push(`${file}: useTranslations() called with a non-literal namespace`);
  }
  if (countMatches(source, /getTranslations\(\s*(?!["{])/g) > 0) {
    problems.push(`${file}: getTranslations() called with a non-literal namespace`);
  }
  const objectCalls = countMatches(source, /getTranslations\(\s*\{/g);
  const objectLiteralCalls = countMatches(source, /getTranslations\(\s*\{[^{}]*namespace:\s*"/g);
  if (objectCalls !== objectLiteralCalls) {
    problems.push(`${file}: getTranslations({...}) called without a literal namespace`);
  }

  const bindings = BINDING_RES.flatMap((re) => [...source.matchAll(re)]);
  const literalCalls =
    countMatches(source, /useTranslations\(\s*"/g) +
    countMatches(source, /getTranslations\(\s*"/g) +
    objectLiteralCalls;
  if (bindings.length !== literalCalls) {
    problems.push(
      `${file}: a useTranslations/getTranslations call is not bound via \`const <name> =\` (getTranslations must be awaited) — extraction cannot attribute its keys`,
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

  // The legal pages render `${section}Title`/`${section}Body` over a local
  // `const SECTIONS = [...] as const` — expand against that same list so
  // the test can never drift from the page.
  const sectionsLiteral = /const\s+SECTIONS\s*=\s*\[([^\]]*)\]/.exec(source)?.[1];
  const sections = sectionsLiteral
    ? [...sectionsLiteral.matchAll(/"([^"]+)"/g)].flatMap((m) => m[1] ?? [])
    : undefined;

  for (const [name, namespace] of namespaceByVar) {
    const callHead = `(?<![\\w.$])${name}(?:\\.(?:rich|raw|markup))?\\(\\s*`;
    if (countMatches(source, new RegExp(`${callHead}(?!["\`])`, "g")) > 0) {
      const wholeKeyValues = DYNAMIC_WHOLE_KEYS[file]?.[name];
      if (wholeKeyValues) {
        for (const value of wholeKeyValues) keys.push(`${namespace}.${value}`);
      } else {
        problems.push(`${file}: ${name}(...) called with a non-literal key`);
      }
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
      const prefix = /^([\w.]*?_)\$\{[^}]+\}$/.exec(template)?.[1];
      if (prefix) {
        const values = DYNAMIC_KEY_VALUES[prefix];
        if (!values) {
          problems.push(
            `${file}: template key \`${template}\` has no entry in DYNAMIC_KEY_VALUES — register the contracts enum that types it`,
          );
          continue;
        }
        for (const value of values) keys.push(`${namespace}.${prefix}${value}`);
        continue;
      }
      const suffix = /^\$\{[^}]+\}([A-Za-z]\w*)$/.exec(template)?.[1];
      if (suffix) {
        if (!sections || sections.length === 0) {
          problems.push(
            `${file}: template key \`${template}\` expands a section list, but no \`const SECTIONS = [...]\` exists in this file`,
          );
          continue;
        }
        for (const section of sections) keys.push(`${namespace}.${section}${suffix}`);
        continue;
      }
      problems.push(
        `${file}: template key \`${template}\` matches no supported shape (\`prefix_\${...}\` or \`\${section}Suffix\`)`,
      );
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

describe("web consumed i18n keys (MM-QA-004 F-24)", () => {
  const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const consumers = new Map<string, string[]>();
  const problems: string[] = [];
  for (const file of SOURCE_DIRS.flatMap((dir) => sourceFiles(join(webRoot, dir)))) {
    const label = relative(webRoot, file);
    const extraction = extractConsumedKeys(readFileSync(file, "utf8"), label);
    problems.push(...extraction.problems);
    for (const key of extraction.keys) {
      consumers.set(key, [...(consumers.get(key) ?? []), label]);
    }
  }

  it("extraction hit no unattributable or unregistered patterns", () => {
    expect(problems).toEqual([]);
  });

  it("extraction is alive, not inert (311 keys at authoring)", () => {
    // Guards the R9 inert-guardrail class: if the regexes drift from how the
    // code actually consumes translations, the sweep collapses toward zero
    // and this floor fails loudly instead of the suite passing vacuously.
    expect(consumers.size).toBeGreaterThan(150);
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
  it("attributes literal keys through the useTranslations binding namespace", () => {
    const { keys, problems } = extractConsumedKeys(
      'const tX = useTranslations("web.a");\nreturn tX("b");',
      "fixture.tsx",
    );
    expect(problems).toEqual([]);
    expect(keys).toEqual(["web.a.b"]);
  });

  it("attributes keys bound via awaited positional getTranslations", () => {
    const { keys, problems } = extractConsumedKeys(
      'const t = await getTranslations("web.a");\nreturn t("b");',
      "fixture.tsx",
    );
    expect(problems).toEqual([]);
    expect(keys).toEqual(["web.a.b"]);
  });

  it("attributes keys bound via awaited object-form getTranslations", () => {
    const { keys, problems } = extractConsumedKeys(
      'const t = await getTranslations({ locale, namespace: "web.a" });\nreturn t("b");',
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

  it("expands a section-suffix template against the file's SECTIONS const", () => {
    const { keys, problems } = extractConsumedKeys(
      'const SECTIONS = ["x", "y"] as const;\nconst t = await getTranslations("web.legal.p");\nreturn t(`${section}Title`);',
      "fixture.tsx",
    );
    expect(problems).toEqual([]);
    expect(keys).toEqual(["web.legal.p.xTitle", "web.legal.p.yTitle"]);
  });

  it("expands a registered whole-key dynamic call against its enum", () => {
    const { keys, problems } = extractConsumedKeys(
      'const t = useTranslations("web.l");\nreturn t(locale);',
      "components/locale-switcher.tsx",
    );
    expect(problems).toEqual([]);
    expect(keys).toEqual(LOCALES.map((locale) => `web.l.${locale}`));
  });

  it("flags an unregistered prefix template instead of skipping it", () => {
    const { keys, problems } = extractConsumedKeys(
      'const t = useTranslations("web.d");\nreturn t(`tier_${row.tier}`);',
      "fixture.tsx",
    );
    expect(keys).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("DYNAMIC_KEY_VALUES");
  });

  it("flags a section-suffix template when the file has no SECTIONS const", () => {
    const { keys, problems } = extractConsumedKeys(
      'const t = useTranslations("web.d");\nreturn t(`${section}Title`);',
      "fixture.tsx",
    );
    expect(keys).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("SECTIONS");
  });

  it("flags non-literal namespaces, unbound calls, conflicting bindings and non-literal keys", () => {
    expect(extractConsumedKeys("useTranslations(ns);", "f.tsx").problems).toHaveLength(1);
    expect(extractConsumedKeys("await getTranslations(ns);", "f.tsx").problems).toHaveLength(1);
    expect(
      extractConsumedKeys("await getTranslations({ locale, namespace: ns });", "f.tsx").problems,
    ).toHaveLength(1);
    expect(extractConsumedKeys('useTranslations("a")("b");', "f.tsx").problems).toHaveLength(1);
    expect(
      // getTranslations without await never matches a binding — unattributable.
      extractConsumedKeys('const t = getTranslations("a");', "f.tsx").problems,
    ).toHaveLength(1);
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
