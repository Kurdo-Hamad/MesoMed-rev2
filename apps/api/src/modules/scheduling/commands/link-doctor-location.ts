/**
 * Links a directory doctor profile to a practice location — the aggregate
 * bookings run against. The doctor profile is validated through the
 * directory module's published lookup (§3.1), never a raw join.
 */
import type { z } from "zod";
import type { linkDoctorLocationInputSchema } from "@mesomed/contracts/scheduling";
import { ErrorCode } from "@mesomed/contracts/errors";
import {
  and,
  doctorLocations,
  eq,
  practiceLocations,
  type DbTransaction,
} from "@mesomed/db/modules/scheduling";
import { AppError } from "../../../kernel/errors.js";
import { doctorProfileExists } from "../../directory/queries/doctor-profile-refs.js";

export type LinkDoctorLocationInput = z.output<typeof linkDoctorLocationInputSchema>;

export async function linkDoctorLocation(
  tx: DbTransaction,
  input: LinkDoctorLocationInput,
): Promise<{ doctorLocationId: string; created: boolean }> {
  if (!(await doctorProfileExists(tx, input.doctorProfileId))) {
    throw new AppError(ErrorCode.NOT_FOUND, "Doctor profile not found");
  }
  const [location] = await tx
    .select({ id: practiceLocations.id })
    .from(practiceLocations)
    .where(eq(practiceLocations.id, input.locationId))
    .limit(1);
  if (!location) throw new AppError(ErrorCode.NOT_FOUND, "Practice location not found");

  const [existing] = await tx
    .select({ id: doctorLocations.id })
    .from(doctorLocations)
    .where(
      and(
        eq(doctorLocations.doctorProfileId, input.doctorProfileId),
        eq(doctorLocations.locationId, input.locationId),
      ),
    )
    .for("update");

  if (existing) {
    await tx
      .update(doctorLocations)
      .set({ active: input.active })
      .where(eq(doctorLocations.id, existing.id));
    return { doctorLocationId: existing.id, created: false };
  }

  const [inserted] = await tx
    .insert(doctorLocations)
    .values({
      doctorProfileId: input.doctorProfileId,
      locationId: input.locationId,
      active: input.active,
    })
    .returning({ id: doctorLocations.id });
  if (!inserted) throw new AppError(ErrorCode.INTERNAL, "Doctor-location insert returned no row");
  return { doctorLocationId: inserted.id, created: true };
}
