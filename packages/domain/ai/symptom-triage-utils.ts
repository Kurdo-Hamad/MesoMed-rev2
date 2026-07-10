/**
 * Pure symptom-triage helpers, ported from the current codebase's
 * provider/symptom-triage-utils.ts (salvage manifest). No DB, no network,
 * no session — fully unit-testable. Consumed by ai/symptom-triage-service.ts.
 */

export const MAX_SYMPTOM_TEXT_CHARS = 1000;

/** Strip control characters (replaced with a space) and cap length. */
export function sanitizeSymptomText(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const stripped = raw.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  const collapsed = stripped.replace(/\s+/g, " ");
  return collapsed.slice(0, MAX_SYMPTOM_TEXT_CHARS);
}

const ENGLISH_RED_FLAGS = [
  "chest pain",
  "suicid",
  "overdose",
  "stroke",
  "heart attack",
  "severe bleeding",
  "can't breathe",
];

const ARABIC_RED_FLAGS = [
  "ألم في الصدر",
  "انتحار",
  "جرعة زائدة",
  "سكتة دماغية",
  "نزيف حاد",
  "نوبة قلبية",
];

const KURDISH_RED_FLAGS = ["ئازاری سنگ", "خۆکوشتن", "هەناسەم تەنگ"];

/** Deterministic trilingual emergency-keyword screen. Runs before any LLM call. */
export function containsRedFlag(text: string): boolean {
  const lower = text.toLowerCase();
  if (ENGLISH_RED_FLAGS.some((k) => lower.includes(k))) return true;
  if (ARABIC_RED_FLAGS.some((k) => text.includes(k))) return true;
  if (KURDISH_RED_FLAGS.some((k) => text.includes(k))) return true;
  return false;
}

const DELIMITER_OPEN = "<<<SYMPTOM_DESCRIPTION";
const DELIMITER_CLOSE = "SYMPTOM_DESCRIPTION>>>";

/** Wrap user text so it cannot forge/close the delimiter block (prompt-injection defense). */
export function delimitUserText(text: string): string {
  const neutralized = text.replaceAll("<<<", "‹‹‹").replaceAll(">>>", "›››");
  return `${DELIMITER_OPEN}\n${neutralized}\n${DELIMITER_CLOSE}`;
}

export interface TriageResponseShape {
  specialties: string[];
  red_flag: boolean;
}

/** Strict JSON contract parser. Tolerates ```/```json fences only. */
export function parseTriageResponse(raw: string): TriageResponseShape | null {
  if (!raw) return null;
  let candidate = raw.trim();
  const fenceMatch = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch && fenceMatch[1] !== undefined) {
    candidate = fenceMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.specialties)) return null;
  if (!obj.specialties.every((s) => typeof s === "string")) return null;
  if (typeof obj.red_flag !== "boolean") return null;

  return { specialties: obj.specialties as string[], red_flag: obj.red_flag };
}

/** Intersect model/keyword output against the live DB whitelist; cap 3, dedupe. */
export function intersectWithWhitelist(
  specialties: string[],
  whitelist: ReadonlySet<string>,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const s of specialties) {
    if (result.length >= 3) break;
    if (!whitelist.has(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    result.push(s);
  }
  return result;
}

export interface KeywordSpecialtyWeight {
  key: string;
  weight: number;
}

export interface KeywordSymptomEntry {
  names: string[];
  specialties: KeywordSpecialtyWeight[];
}

/** Deterministic trilingual substring match fallback (no API key / model failure). */
export function matchSymptomKeywords(text: string, entries: KeywordSymptomEntry[]): string[] {
  const lower = text.toLowerCase();
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const matched = entry.names.some((name) => lower.includes(name.toLowerCase()));
    if (!matched) continue;
    for (const spec of entry.specialties) {
      if (seen.has(spec.key)) continue;
      seen.add(spec.key);
      result.push(spec.key);
    }
  }
  return result;
}
