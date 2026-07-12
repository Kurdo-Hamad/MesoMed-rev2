/**
 * Published triage-taxonomy lookup for the Phase 7 AI module (§3.1): the
 * AI triage service never joins directory tables directly — it reads the
 * active specialty whitelist and the deterministic keyword taxonomy
 * through these two functions only.
 */
import { eq, specialties, symptomSpecialtyMap, symptoms, type DbExecutor } from "@mesomed/db";

export interface ActiveSpecialty {
  key: string;
  nameEn: string;
}

/** The whitelist a triage result (model or keyword engine) must intersect against. */
export async function listActiveSpecialtiesForTriage(db: DbExecutor): Promise<ActiveSpecialty[]> {
  const rows = await db
    .select({ key: specialties.key, nameEn: specialties.nameEn })
    .from(specialties)
    .where(eq(specialties.active, true));
  return rows;
}

export interface TriageKeywordEntry {
  names: string[];
  specialties: Array<{ key: string; weight: number }>;
}

/** Deterministic trilingual keyword→specialty taxonomy, for the keyword-fallback engine. */
export async function listTriageKeywordEntries(db: DbExecutor): Promise<TriageKeywordEntry[]> {
  const rows = await db
    .select({
      symptomId: symptoms.id,
      nameEn: symptoms.nameEn,
      nameAr: symptoms.nameAr,
      nameCkb: symptoms.nameCkb,
      specialtyKey: symptomSpecialtyMap.specialtyKey,
      weight: symptomSpecialtyMap.weight,
    })
    .from(symptomSpecialtyMap)
    .innerJoin(symptoms, eq(symptoms.id, symptomSpecialtyMap.symptomId))
    .where(eq(symptoms.active, true));

  const bySymptom = new Map<string, TriageKeywordEntry>();
  for (const row of rows) {
    let entry = bySymptom.get(row.symptomId);
    if (!entry) {
      entry = { names: [row.nameEn, row.nameAr, row.nameCkb], specialties: [] };
      bySymptom.set(row.symptomId, entry);
    }
    entry.specialties.push({ key: row.specialtyKey, weight: row.weight });
  }
  return [...bySymptom.values()];
}
