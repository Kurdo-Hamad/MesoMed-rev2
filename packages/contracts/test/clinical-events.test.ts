import { describe, expect, it } from "vitest";
import { createEventRegistry } from "../src/events/index.js";
import {
  CLINICAL_EVENTS,
  encounterCreatedV1,
  prescriptionAmendedV1,
  prescriptionDiscontinuedV1,
  prescriptionIssuedV1,
  supportAccessGrantedV1,
  visitNoteAddedV1,
} from "../src/events/clinical.js";

describe("clinical event contracts", () => {
  it("exposes exactly the Phase 5 + ADR-0010 event set, all v1", () => {
    expect(CLINICAL_EVENTS.map((event) => event.name).sort()).toEqual([
      "clinical.encounter_created.v1",
      "clinical.prescription_amended.v1",
      "clinical.prescription_discontinued.v1",
      "clinical.prescription_issued.v1",
      "clinical.support_access_granted.v1",
      "clinical.support_access_revoked.v1",
      "clinical.visit_note_added.v1",
    ]);
  });

  it("registers cleanly into an event registry", () => {
    const registry = createEventRegistry(CLINICAL_EVENTS);
    expect(registry.names()).toHaveLength(CLINICAL_EVENTS.length);
  });

  it("encounter_created carries the denormalized appointment snapshot ids", () => {
    const parsed = encounterCreatedV1.envelope.parse({
      name: "clinical.encounter_created.v1",
      version: 1,
      payload: {
        encounterId: "e1",
        appointmentId: "a1",
        doctorProfileId: "d1",
        patientProfileId: "p1",
        startsAt: "2026-07-11T09:00:00.000Z",
        endsAt: "2026-07-11T09:30:00.000Z",
      },
    });
    expect(parsed.payload.appointmentId).toBe("a1");
  });

  it("privacy invariant: visit_note_added carries ids only — content is stripped", () => {
    // Zod strips unknown keys: even a buggy emitter passing content cannot
    // get it past the envelope validation into the outbox payload.
    const parsed = visitNoteAddedV1.payload.parse({
      visitNoteId: "n1",
      encounterId: "e1",
      authorUserId: "u1",
      amendsNoteId: "n0",
      content: "clinical text",
    });
    expect(parsed).toEqual({
      visitNoteId: "n1",
      encounterId: "e1",
      authorUserId: "u1",
      amendsNoteId: "n0",
    });
    expect("content" in parsed).toBe(false);
  });

  it("privacy invariant: prescription events carry ids only — medication content is stripped", () => {
    const issued = prescriptionIssuedV1.payload.parse({
      prescriptionId: "rx1",
      encounterId: "e1",
      doctorProfileId: "d1",
      patientProfileId: "p1",
      medicationName: "amoxicillin",
      dosage: "500mg",
      instructions: "with food",
    });
    expect(issued).toEqual({
      prescriptionId: "rx1",
      encounterId: "e1",
      doctorProfileId: "d1",
      patientProfileId: "p1",
    });
    expect("medicationName" in issued).toBe(false);
  });

  it("prescription_amended links the superseded revision", () => {
    const parsed = prescriptionAmendedV1.envelope.parse({
      name: "clinical.prescription_amended.v1",
      version: 1,
      payload: {
        prescriptionId: "rx2",
        encounterId: "e1",
        doctorProfileId: "d1",
        patientProfileId: "p1",
        supersedesPrescriptionId: "rx1",
      },
    });
    expect(parsed.payload.supersedesPrescriptionId).toBe("rx1");
  });

  it("prescription_discontinued parses its envelope", () => {
    const parsed = prescriptionDiscontinuedV1.envelope.parse({
      name: "clinical.prescription_discontinued.v1",
      version: 1,
      payload: {
        prescriptionId: "rx1",
        encounterId: "e1",
        doctorProfileId: "d1",
        patientProfileId: "p1",
      },
    });
    expect(parsed.payload.prescriptionId).toBe("rx1");
  });

  it("support_access_granted carries the accountability trail", () => {
    const parsed = supportAccessGrantedV1.payload.parse({
      grantId: "g1",
      encounterId: "e1",
      adminUserId: "adm",
      grantedBy: "adm",
      reason: "complaint #1",
      expiresAt: "2026-07-11T12:00:00.000Z",
    });
    expect(parsed.reason).toBe("complaint #1");
  });
});
