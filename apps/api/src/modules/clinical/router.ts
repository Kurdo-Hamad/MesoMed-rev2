/**
 * Clinical module tRPC surface (MM-PLAN-001 §5 Phase 5). Every procedure
 * is role-gated at the kernel (§3.6 layer a) and actor-bound inside the
 * handler (layer b). There is NO command that creates an encounter — the
 * booking.completed.v1 subscriber is the only creator.
 *
 * Actor matrix (layer b, enforced in handlers):
 *   doctorEncounters          doctor bound to their directory profile
 *   myEncounters              patient bound to their claimed profile
 *   encounterNotes            owning doctor · encounter's patient
 *   addVisitNote              owning doctor
 *   amendVisitNote            owning doctor (target must be an original note)
 *   issuePrescription         owning doctor
 *   amendPrescription         owning doctor (target must be the active revision)
 *   discontinuePrescription   owning doctor (target must be the active revision)
 *   patientClinicalHistory    doctor with a treating relationship (ADR-0010)
 *   myClinicalRecord          patient bound to their claimed profile
 *   upsertMedicalProfile      patient, own row only (keyed by session profile)
 *   addReportedMedication     patient, own rows only
 *   removeReportedMedication  patient, own rows only
 *   grantSupportAccess        admin (self-issued, reasoned, time-boxed)
 *   revokeSupportAccess       admin
 *   supportNotes              admin holding a usable (unexpired) grant
 *   listSupportGrants         admin
 */
import {
  addReportedMedicationInputSchema,
  addVisitNoteInputSchema,
  amendPrescriptionInputSchema,
  amendVisitNoteInputSchema,
  encounterIdInputSchema,
  grantIdInputSchema,
  grantSupportAccessInputSchema,
  grantSupportAccessResultSchema,
  issuePrescriptionInputSchema,
  listEncountersOutputSchema,
  listSupportGrantsInputSchema,
  listSupportGrantsOutputSchema,
  medicalProfileSchema,
  myClinicalRecordOutputSchema,
  patientClinicalHistoryInputSchema,
  patientClinicalHistoryOutputSchema,
  prescriptionIdInputSchema,
  prescriptionResultSchema,
  removeReportedMedicationResultSchema,
  reportedMedicationIdInputSchema,
  reportedMedicationSchema,
  revokeSupportAccessResultSchema,
  upsertMedicalProfileInputSchema,
  visitNoteResultSchema,
  visitNotesOutputSchema,
} from "@mesomed/contracts/clinical";
import { roleProcedure } from "../../kernel/authz.js";
import { router } from "../../kernel/trpc.js";
import { addVisitNote, amendVisitNote } from "./commands/add-visit-note.js";
import { upsertMedicalProfile } from "./commands/medical-profile.js";
import {
  amendPrescription,
  discontinuePrescription,
  issuePrescription,
} from "./commands/prescriptions.js";
import {
  addReportedMedication,
  removeReportedMedication,
} from "./commands/reported-medications.js";
import { grantSupportAccess, revokeSupportAccess } from "./commands/support-access.js";
import { getMyClinicalRecord, getPatientClinicalHistory } from "./queries/clinical-history.js";
import { getEncounterNotes, listDoctorEncounters, listMyEncounters } from "./queries/encounters.js";
import { getSupportNotes, listSupportGrants } from "./queries/support-grants.js";

export function createClinicalRouter() {
  return router({
    // ── Doctor ─────────────────────────────────────────────────────────
    doctorEncounters: roleProcedure("doctor")
      .output(listEncountersOutputSchema)
      .query(({ ctx }) => listDoctorEncounters(ctx.db, ctx.session)),

    addVisitNote: roleProcedure("doctor")
      .input(addVisitNoteInputSchema)
      .output(visitNoteResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => addVisitNote(tx, ctx.outbox, ctx.session, input)),
      ),

    amendVisitNote: roleProcedure("doctor")
      .input(amendVisitNoteInputSchema)
      .output(visitNoteResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => amendVisitNote(tx, ctx.outbox, ctx.session, input)),
      ),

    // ── Prescriptions (ADR-0010, owning doctor only) ───────────────────
    issuePrescription: roleProcedure("doctor")
      .input(issuePrescriptionInputSchema)
      .output(prescriptionResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => issuePrescription(tx, ctx.outbox, ctx.session, input)),
      ),

    amendPrescription: roleProcedure("doctor")
      .input(amendPrescriptionInputSchema)
      .output(prescriptionResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => amendPrescription(tx, ctx.outbox, ctx.session, input)),
      ),

    discontinuePrescription: roleProcedure("doctor")
      .input(prescriptionIdInputSchema)
      .output(prescriptionResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => discontinuePrescription(tx, ctx.outbox, ctx.session, input)),
      ),

    // ── Clinical history (ADR-0010, continuity of care) ────────────────
    patientClinicalHistory: roleProcedure("doctor")
      .input(patientClinicalHistoryInputSchema)
      .output(patientClinicalHistoryOutputSchema)
      .query(({ ctx, input }) => getPatientClinicalHistory(ctx.db, ctx.session, input)),

    myClinicalRecord: roleProcedure("patient")
      .output(myClinicalRecordOutputSchema)
      .query(({ ctx }) => getMyClinicalRecord(ctx.db, ctx.session)),

    // ── Patient-authored data (ADR-0010, own rows only) ────────────────
    upsertMedicalProfile: roleProcedure("patient")
      .input(upsertMedicalProfileInputSchema)
      .output(medicalProfileSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => upsertMedicalProfile(tx, ctx.session, input)),
      ),

    addReportedMedication: roleProcedure("patient")
      .input(addReportedMedicationInputSchema)
      .output(reportedMedicationSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => addReportedMedication(tx, ctx.session, input)),
      ),

    removeReportedMedication: roleProcedure("patient")
      .input(reportedMedicationIdInputSchema)
      .output(removeReportedMedicationResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => removeReportedMedication(tx, ctx.session, input)),
      ),

    // ── Shared reads (doctor owns · patient reads own) ─────────────────
    encounterNotes: roleProcedure("doctor", "patient")
      .input(encounterIdInputSchema)
      .output(visitNotesOutputSchema)
      .query(({ ctx, input }) => getEncounterNotes(ctx.db, ctx.session, input.encounterId)),

    // ── Patient ────────────────────────────────────────────────────────
    myEncounters: roleProcedure("patient")
      .output(listEncountersOutputSchema)
      .query(({ ctx }) => listMyEncounters(ctx.db, ctx.session)),

    // ── Admin support access (time-boxed, audited) ─────────────────────
    grantSupportAccess: roleProcedure("admin")
      .input(grantSupportAccessInputSchema)
      .output(grantSupportAccessResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) =>
          grantSupportAccess(tx, ctx.outbox, ctx.session, {
            encounterId: input.encounterId,
            reason: input.reason,
            expiresAt: new Date(input.expiresAt),
          }),
        ),
      ),

    revokeSupportAccess: roleProcedure("admin")
      .input(grantIdInputSchema)
      .output(revokeSupportAccessResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => revokeSupportAccess(tx, ctx.outbox, ctx.session, input)),
      ),

    supportNotes: roleProcedure("admin")
      .input(grantIdInputSchema)
      .output(visitNotesOutputSchema)
      .query(({ ctx, input }) => getSupportNotes(ctx.db, ctx.session, input.grantId)),

    listSupportGrants: roleProcedure("admin")
      .input(listSupportGrantsInputSchema)
      .output(listSupportGrantsOutputSchema)
      .query(({ ctx, input }) => listSupportGrants(ctx.db, { encounterId: input.encounterId })),
  });
}
