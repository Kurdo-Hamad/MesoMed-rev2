/**
 * Clinical module tRPC surface (MM-PLAN-001 §5 Phase 5). Every procedure
 * is role-gated at the kernel (§3.6 layer a) and actor-bound inside the
 * handler (layer b). There is NO command that creates an encounter — the
 * booking.completed.v1 subscriber is the only creator.
 *
 * Actor matrix (layer b, enforced in handlers):
 *   doctorEncounters      doctor bound to their directory profile
 *   myEncounters          patient bound to their claimed profile
 *   encounterNotes        owning doctor · encounter's patient
 *   addVisitNote          owning doctor
 *   amendVisitNote        owning doctor (target must be an original note)
 *   grantSupportAccess    admin (self-issued, reasoned, time-boxed)
 *   revokeSupportAccess   admin
 *   supportNotes          admin holding a usable (unexpired) grant
 *   listSupportGrants     admin
 */
import {
  addVisitNoteInputSchema,
  amendVisitNoteInputSchema,
  encounterIdInputSchema,
  grantIdInputSchema,
  grantSupportAccessInputSchema,
  grantSupportAccessResultSchema,
  listEncountersOutputSchema,
  listSupportGrantsInputSchema,
  listSupportGrantsOutputSchema,
  revokeSupportAccessResultSchema,
  visitNoteResultSchema,
  visitNotesOutputSchema,
} from "@mesomed/contracts/clinical";
import { roleProcedure } from "../../kernel/authz.js";
import { router } from "../../kernel/trpc.js";
import { addVisitNote, amendVisitNote } from "./commands/add-visit-note.js";
import { grantSupportAccess, revokeSupportAccess } from "./commands/support-access.js";
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
