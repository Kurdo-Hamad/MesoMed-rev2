/**
 * Prescription commands (clinical extension, ADR-0010). Content is
 * append-only (§3.5): an amendment is a NEW active revision superseding
 * its target atomically inside the SECURITY DEFINER channel; a
 * discontinuation is a status flip. The DB layer (guard triggers +
 * definer functions) enforces the same rules underneath this code.
 *
 * Layer b (§3.6): only the target encounter's owning doctor issues,
 * amends or discontinues. A treating doctor who does not own the
 * encounter reads history but never mutates another doctor's
 * prescriptions.
 */
import { validatePrescriptionTransition } from "@mesomed/domain/clinical";
import { ErrorCode } from "@mesomed/contracts/errors";
import type { DbTransaction } from "@mesomed/db";
import { AppError } from "../../../kernel/errors.js";
import type { Session } from "../../../kernel/context.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import {
  amendPrescriptionRow,
  discontinuePrescriptionRow,
  issuePrescriptionRow,
  readPrescriptionRows,
  requireEncounterActor,
  type PrescriptionContent,
  type PrescriptionRow,
} from "../shared.js";

export interface PrescriptionResult {
  prescriptionId: string;
  encounterId: string;
  status: "active" | "superseded" | "discontinued";
  supersedesPrescriptionId: string | null;
}

export interface PrescriptionContentInput {
  medicationName: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions?: string;
}

function toContent(input: PrescriptionContentInput): PrescriptionContent {
  return {
    medicationName: input.medicationName,
    dosage: input.dosage,
    frequency: input.frequency,
    duration: input.duration,
    instructions: input.instructions ?? null,
  };
}

/**
 * Load the target revision and prove the session doctor owns its
 * encounter. The encounter read is the audited ownership check; the
 * prescription read is scoped by id.
 */
async function requireOwnedPrescription(
  tx: DbTransaction,
  session: Session,
  prescriptionId: string,
): Promise<PrescriptionRow> {
  const [target] = await readPrescriptionRows(tx, session.userId, { prescriptionId });
  if (!target) throw new AppError(ErrorCode.NOT_FOUND, "Prescription not found");
  await requireEncounterActor(tx, session, target.encounterId, ["owning_doctor"]);
  return target;
}

export async function issuePrescription(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  session: Session,
  input: PrescriptionContentInput & { encounterId: string },
): Promise<PrescriptionResult> {
  const encounter = await requireEncounterActor(tx, session, input.encounterId, ["owning_doctor"]);

  const prescriptionId = await issuePrescriptionRow(tx, {
    ...toContent(input),
    encounterId: input.encounterId,
    actor: session.userId,
  });

  await outbox.emit(tx, {
    name: "clinical.prescription_issued.v1",
    aggregateType: "prescription",
    aggregateId: prescriptionId,
    payload: {
      prescriptionId,
      encounterId: encounter.id,
      doctorProfileId: encounter.doctorProfileId,
      patientProfileId: encounter.patientProfileId,
    },
  });

  return {
    prescriptionId,
    encounterId: encounter.id,
    status: "active",
    supersedesPrescriptionId: null,
  };
}

export async function amendPrescription(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  session: Session,
  input: PrescriptionContentInput & { prescriptionId: string },
): Promise<PrescriptionResult> {
  const target = await requireOwnedPrescription(tx, session, input.prescriptionId);

  const verdict = validatePrescriptionTransition(target.status, "superseded");
  if (!verdict.ok) {
    // The DB channel re-checks this invariant; here it becomes a typed error.
    throw new AppError(
      ErrorCode.PRESCRIPTION_NOT_ACTIVE,
      "Only the active revision of a prescription can be amended",
    );
  }

  const prescriptionId = await amendPrescriptionRow(tx, {
    ...toContent(input),
    prescriptionId: input.prescriptionId,
    actor: session.userId,
  });

  await outbox.emit(tx, {
    name: "clinical.prescription_amended.v1",
    aggregateType: "prescription",
    aggregateId: prescriptionId,
    payload: {
      prescriptionId,
      encounterId: target.encounterId,
      doctorProfileId: target.doctorProfileId,
      patientProfileId: target.patientProfileId,
      supersedesPrescriptionId: target.id,
    },
  });

  return {
    prescriptionId,
    encounterId: target.encounterId,
    status: "active",
    supersedesPrescriptionId: target.id,
  };
}

export async function discontinuePrescription(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  session: Session,
  input: { prescriptionId: string },
): Promise<PrescriptionResult> {
  const target = await requireOwnedPrescription(tx, session, input.prescriptionId);

  const verdict = validatePrescriptionTransition(target.status, "discontinued");
  if (!verdict.ok) {
    throw new AppError(
      ErrorCode.PRESCRIPTION_NOT_ACTIVE,
      "Only the active revision of a prescription can be discontinued",
    );
  }

  await discontinuePrescriptionRow(tx, input.prescriptionId, session.userId);

  await outbox.emit(tx, {
    name: "clinical.prescription_discontinued.v1",
    aggregateType: "prescription",
    aggregateId: target.id,
    payload: {
      prescriptionId: target.id,
      encounterId: target.encounterId,
      doctorProfileId: target.doctorProfileId,
      patientProfileId: target.patientProfileId,
    },
  });

  return {
    prescriptionId: target.id,
    encounterId: target.encounterId,
    status: "discontinued",
    supersedesPrescriptionId: target.supersedesPrescriptionId,
  };
}
