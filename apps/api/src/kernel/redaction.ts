/**
 * Pino redaction paths for PII fields (MM-ARC-002 §6.5, MM-PLAN-001 §5
 * Phase 7): phone numbers and names must never reach log output in the
 * clear, however deeply nested in a logged object. Wired into the
 * Fastify logger options in app.ts.
 */
const FIELD_NAMES = [
  "phoneNumber",
  "normalizedPhone",
  "phone",
  "patientPhone",
  "to",
  "destination",
  "fullName",
  "name",
  "email",
] as const;

const MAX_DEPTH = 5;

function pathsFor(field: string): string[] {
  const paths = [field, `*.${field}`];
  let prefix = "*";
  for (let depth = 2; depth <= MAX_DEPTH; depth++) {
    prefix = `${prefix}.*`;
    paths.push(`${prefix}.${field}`);
  }
  return paths;
}

export const REDACT_PATHS: string[] = FIELD_NAMES.flatMap(pathsFor);
