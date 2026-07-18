/**
 * Assigns (or re-activates/deactivates) a secretary to a doctor-location's
 * front desk. The assignment gates walk-in booking, confirm, check-in and
 * no-show commands (§3.6 layer b).
 */
import type { z } from "zod";
import type { assignSecretaryInputSchema } from "@mesomed/contracts/scheduling";
import { ErrorCode } from "@mesomed/contracts/errors";
import {
  and,
  doctorLocations,
  eq,
  secretaryAssignments,
  type DbTransaction,
} from "@mesomed/db/modules/scheduling";
import { AppError } from "../../../kernel/errors.js";

export type AssignSecretaryInput = z.output<typeof assignSecretaryInputSchema>;

export async function assignSecretary(
  tx: DbTransaction,
  input: AssignSecretaryInput,
): Promise<{ assignmentId: string }> {
  const [doctorLocation] = await tx
    .select({ id: doctorLocations.id })
    .from(doctorLocations)
    .where(eq(doctorLocations.id, input.doctorLocationId))
    .limit(1);
  if (!doctorLocation) throw new AppError(ErrorCode.NOT_FOUND, "Doctor location not found");

  const [existing] = await tx
    .select({ id: secretaryAssignments.id })
    .from(secretaryAssignments)
    .where(
      and(
        eq(secretaryAssignments.secretaryUserId, input.secretaryUserId),
        eq(secretaryAssignments.doctorLocationId, input.doctorLocationId),
      ),
    )
    .for("update");

  if (existing) {
    await tx
      .update(secretaryAssignments)
      .set({ active: input.active })
      .where(eq(secretaryAssignments.id, existing.id));
    return { assignmentId: existing.id };
  }

  const [inserted] = await tx
    .insert(secretaryAssignments)
    .values({
      secretaryUserId: input.secretaryUserId,
      doctorLocationId: input.doctorLocationId,
      active: input.active,
    })
    .returning({ id: secretaryAssignments.id });
  if (!inserted) throw new AppError(ErrorCode.INTERNAL, "Assignment insert returned no row");
  return { assignmentId: inserted.id };
}
