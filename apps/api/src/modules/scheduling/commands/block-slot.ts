/**
 * Ad-hoc unavailability: blocks a UTC time range at a doctor-location
 * (vacation, conference, emergency closure). Blocked ranges are subtracted
 * during slot generation; existing appointments are untouched — moving
 * them is an explicit reschedule/cancel decision, never a side effect.
 */
import type { z } from "zod";
import type {
  blockSlotInputSchema,
  removeBlockedSlotInputSchema,
} from "@mesomed/contracts/scheduling";
import { ErrorCode } from "@mesomed/contracts/errors";
import {
  and,
  blockedSlots,
  doctorLocations,
  eq,
  type DbTransaction,
} from "@mesomed/db/modules/scheduling";
import { AppError } from "../../../kernel/errors.js";

export type BlockSlotInput = z.output<typeof blockSlotInputSchema>;
export type RemoveBlockedSlotInput = z.output<typeof removeBlockedSlotInputSchema>;

export async function blockSlot(
  tx: DbTransaction,
  input: BlockSlotInput & { createdBy: string | null },
): Promise<{ id: string }> {
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (startsAt.getTime() >= endsAt.getTime()) {
    throw new AppError(ErrorCode.VALIDATION, "Blocked range start must precede its end");
  }
  const [doctorLocation] = await tx
    .select({ id: doctorLocations.id })
    .from(doctorLocations)
    .where(eq(doctorLocations.id, input.doctorLocationId))
    .limit(1);
  if (!doctorLocation) throw new AppError(ErrorCode.NOT_FOUND, "Doctor location not found");

  const [inserted] = await tx
    .insert(blockedSlots)
    .values({
      doctorLocationId: input.doctorLocationId,
      startsAt,
      endsAt,
      reason: input.reason ?? null,
      createdBy: input.createdBy,
    })
    .returning({ id: blockedSlots.id });
  if (!inserted) throw new AppError(ErrorCode.INTERNAL, "Blocked-slot insert returned no row");
  return { id: inserted.id };
}

export async function removeBlockedSlot(
  tx: DbTransaction,
  input: RemoveBlockedSlotInput,
): Promise<{ removed: boolean }> {
  const deleted = await tx
    .delete(blockedSlots)
    .where(
      and(
        eq(blockedSlots.id, input.blockedSlotId),
        eq(blockedSlots.doctorLocationId, input.doctorLocationId),
      ),
    )
    .returning({ id: blockedSlots.id });
  return { removed: deleted.length > 0 };
}
