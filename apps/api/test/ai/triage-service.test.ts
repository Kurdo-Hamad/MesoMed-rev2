import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pino from "pino";
import { createMockAiGateway, type MockAiGateway } from "@mesomed/platform";
import { specialties, symptomSpecialtyMap, symptoms } from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { REDACT_PATHS } from "../../src/kernel/redaction.js";
import { createTriageService, type TriageService } from "../../src/modules/ai/triage-service.js";

const CARDIOLOGY = "cardiology-triage-test";
const DERMATOLOGY = "dermatology-triage-test";
const KNEE_ACHE_SYMPTOM_TEXT = "I have had a persistent knee ache for two days";

describe("AI triage service (MM-PLAN-001 §5 Phase 7, MM-EXEC-003 Phase 6 port)", () => {
  let tdb: TestDatabase;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    await tdb.db.insert(specialties).values([
      { key: CARDIOLOGY, nameEn: "Cardiology", nameAr: "قلب", nameCkb: "دڵ" },
      { key: DERMATOLOGY, nameEn: "Dermatology", nameAr: "جلدية", nameCkb: "پێست" },
    ]);
    const [kneeSymptom] = await tdb.db
      .insert(symptoms)
      .values({
        slug: "knee-ache-triage-test",
        nameEn: "knee ache",
        nameAr: "ألم الركبة",
        nameCkb: "ئازاری ئەژنۆ",
      })
      .returning({ id: symptoms.id });
    await tdb.db
      .insert(symptomSpecialtyMap)
      .values({ symptomId: kneeSymptom!.id, specialtyKey: DERMATOLOGY, weight: 1 });
  }, 60_000);

  afterAll(async () => {
    await tdb.close();
  });

  function buildService(ai: MockAiGateway, log = pino({ level: "silent" })): TriageService {
    return createTriageService({ db: tdb.db, ai, log });
  }

  it("the deterministic red-flag screen fires unconditionally, before the model is ever called", async () => {
    const ai = createMockAiGateway([
      '{"specialties": ["cardiology-triage-test"], "red_flag": false}',
    ]);
    const service = buildService(ai);

    const result = await service.triageSymptoms("severe chest pain and can't breathe");
    expect(result).toEqual({ redFlag: true, specialties: [], engine: "red_flag" });
    // The queued model response was never consumed — the gateway was never called.
    expect(ai.queue).toHaveLength(1);
  });

  it("falls back to the keyword engine when the model provider is killed", async () => {
    const ai = createMockAiGateway();
    ai.failing = true;
    const service = buildService(ai);

    const result = await service.triageSymptoms(KNEE_ACHE_SYMPTOM_TEXT);
    expect(result.engine).toBe("keyword");
    expect(result.redFlag).toBe(false);
    expect(result.specialties).toEqual([DERMATOLOGY]);
  });

  it("falls back to the keyword engine on malformed model output", async () => {
    const ai = createMockAiGateway(["not json at all"]);
    const service = buildService(ai);

    const result = await service.triageSymptoms(KNEE_ACHE_SYMPTOM_TEXT);
    expect(result.engine).toBe("keyword");
    expect(result.specialties).toEqual([DERMATOLOGY]);
  });

  it("drops a model-returned specialty that isn't in the live whitelist, then falls back", async () => {
    const ai = createMockAiGateway([
      '{"specialties": ["not-a-real-specialty"], "red_flag": false}',
    ]);
    const service = buildService(ai);

    const result = await service.triageSymptoms(KNEE_ACHE_SYMPTOM_TEXT);
    // Empty intersection against the whitelist -> keyword fallback engine.
    expect(result.engine).toBe("keyword");
    expect(result.specialties).toEqual([DERMATOLOGY]);
  });

  it("returns the model's whitelisted specialties when the model succeeds", async () => {
    const ai = createMockAiGateway([`{"specialties": ["${CARDIOLOGY}"], "red_flag": false}`]);
    const service = buildService(ai);

    const result = await service.triageSymptoms("some unrelated text");
    expect(result).toEqual({ redFlag: false, specialties: [CARDIOLOGY], engine: "model" });
  });

  it("honors a model-flagged red_flag response", async () => {
    const ai = createMockAiGateway(['{"specialties": [], "red_flag": true}']);
    const service = buildService(ai);

    const result = await service.triageSymptoms("some ambiguous text the keyword screen misses");
    expect(result).toEqual({ redFlag: true, specialties: [], engine: "model" });
  });

  it("never logs the raw symptom text, even on the model-failure fallback path", async () => {
    const lines: string[] = [];
    const stream = { write: (line: string) => lines.push(line) };
    const log = pino(
      { level: "warn", redact: { paths: REDACT_PATHS, censor: "[REDACTED]" } },
      stream,
    );

    const ai = createMockAiGateway();
    ai.failing = true;
    const service = buildService(ai, log);

    const secretText = "UNIQUE_SYMPTOM_MARKER_78421 severe chest pain";
    // (chest pain would trip the red-flag screen before reaching the model —
    // use a marker-only text so the model path is actually exercised.)
    await service.triageSymptoms("UNIQUE_SYMPTOM_MARKER_78421 some vague ache");

    const logged = lines.join("\n");
    expect(logged).not.toContain("UNIQUE_SYMPTOM_MARKER_78421");
    expect(logged).not.toContain(secretText);
  });
});
