/**
 * Scheduling module tRPC surface (MM-PLAN-001 §5 Phase 4). Structure
 * commands (locations, links, secretary assignments) are admin-only;
 * schedule/blocked-slot commands additionally admit the owning doctor
 * (and, for blocked slots, an assigned secretary) via the layer-b check
 * (§3.6). All I/O is typed by the contracts package (§3.11/§3.12).
 */
import {
  assignSecretaryInputSchema,
  assignSecretaryResultSchema,
  blockSlotInputSchema,
  blockSlotResultSchema,
  linkDoctorLocationInputSchema,
  linkDoctorLocationResultSchema,
  listDoctorLocationsInputSchema,
  listDoctorLocationsOutputSchema,
  myWorkplacesOutputSchema,
  removeBlockedSlotInputSchema,
  removeBlockedSlotResultSchema,
  setWeeklyScheduleInputSchema,
  setWeeklyScheduleResultSchema,
  upsertLocationInputSchema,
  upsertLocationResultSchema,
} from "@mesomed/contracts/scheduling";
import { roleProcedure } from "../../kernel/authz.js";
import { publicProcedure, router } from "../../kernel/trpc.js";
import { assignSecretary } from "./commands/assign-secretary.js";
import { blockSlot, removeBlockedSlot } from "./commands/block-slot.js";
import { linkDoctorLocation } from "./commands/link-doctor-location.js";
import { setWeeklySchedule } from "./commands/set-weekly-schedule.js";
import { upsertLocation } from "./commands/upsert-location.js";
import { listDoctorLocations } from "./queries/doctor-locations.js";
import { listMyWorkplaces } from "./queries/my-workplaces.js";
import { assertCanManageDoctorLocation } from "./shared.js";

export function createSchedulingRouter() {
  return router({
    // ── Public reads ───────────────────────────────────────────────────
    doctorLocations: publicProcedure
      .input(listDoctorLocationsInputSchema)
      .output(listDoctorLocationsOutputSchema)
      .query(({ ctx, input }) => listDoctorLocations(ctx.db, input.doctorProfileId)),

    // ── Clinic-side reads (Phase 8 dashboards) ─────────────────────────
    myWorkplaces: roleProcedure("doctor", "secretary")
      .output(myWorkplacesOutputSchema)
      .query(({ ctx }) => listMyWorkplaces(ctx.db, ctx.session)),

    // ── Structure commands (admin) ─────────────────────────────────────
    upsertLocation: roleProcedure("admin")
      .input(upsertLocationInputSchema)
      .output(upsertLocationResultSchema)
      .mutation(({ ctx, input }) => ctx.db.transaction((tx) => upsertLocation(tx, input))),

    linkDoctorLocation: roleProcedure("admin")
      .input(linkDoctorLocationInputSchema)
      .output(linkDoctorLocationResultSchema)
      .mutation(({ ctx, input }) => ctx.db.transaction((tx) => linkDoctorLocation(tx, input))),

    assignSecretary: roleProcedure("admin")
      .input(assignSecretaryInputSchema)
      .output(assignSecretaryResultSchema)
      .mutation(({ ctx, input }) => ctx.db.transaction((tx) => assignSecretary(tx, input))),

    // ── Schedule commands (admin or owning doctor) ─────────────────────
    setWeeklySchedule: roleProcedure("admin", "doctor")
      .input(setWeeklyScheduleInputSchema)
      .output(setWeeklyScheduleResultSchema)
      .mutation(async ({ ctx, input }) => {
        await assertCanManageDoctorLocation(ctx.db, ctx.session, input.doctorLocationId);
        return ctx.db.transaction((tx) => setWeeklySchedule(tx, input));
      }),

    blockSlot: roleProcedure("admin", "doctor", "secretary")
      .input(blockSlotInputSchema)
      .output(blockSlotResultSchema)
      .mutation(async ({ ctx, input }) => {
        await assertCanManageDoctorLocation(ctx.db, ctx.session, input.doctorLocationId, {
          allowSecretary: true,
        });
        return ctx.db.transaction((tx) =>
          blockSlot(tx, { ...input, createdBy: ctx.session.userId }),
        );
      }),

    removeBlockedSlot: roleProcedure("admin", "doctor", "secretary")
      .input(removeBlockedSlotInputSchema)
      .output(removeBlockedSlotResultSchema)
      .mutation(async ({ ctx, input }) => {
        await assertCanManageDoctorLocation(ctx.db, ctx.session, input.doctorLocationId, {
          allowSecretary: true,
        });
        return ctx.db.transaction((tx) => removeBlockedSlot(tx, input));
      }),
  });
}
