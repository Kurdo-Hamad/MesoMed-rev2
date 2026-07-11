/**
 * Admin practice-location upsert (MM-PLAN-001 §5 Phase 4), keyed by slug —
 * the same deterministic upsert discipline as directory taxonomy commands.
 */
import type { z } from "zod";
import type { upsertLocationInputSchema } from "@mesomed/contracts/scheduling";
import { ErrorCode } from "@mesomed/contracts/errors";
import { eq, practiceLocations, type DbTransaction } from "@mesomed/db";
import { AppError } from "../../../kernel/errors.js";

export type UpsertLocationInput = z.output<typeof upsertLocationInputSchema>;

export async function upsertLocation(
  tx: DbTransaction,
  input: UpsertLocationInput,
): Promise<{ id: string; created: boolean }> {
  const values = {
    slug: input.slug,
    nameEn: input.name.en,
    nameAr: input.name.ar,
    nameCkb: input.name.ckb,
    addressEn: input.address?.en ?? null,
    addressAr: input.address?.ar ?? null,
    addressCkb: input.address?.ckb ?? null,
    phone: input.phone ?? null,
    timeZone: input.timeZone,
    active: input.active,
    updatedAt: new Date(),
  };

  const [existing] = await tx
    .select({ id: practiceLocations.id })
    .from(practiceLocations)
    .where(eq(practiceLocations.slug, input.slug))
    .for("update");

  if (existing) {
    await tx.update(practiceLocations).set(values).where(eq(practiceLocations.id, existing.id));
    return { id: existing.id, created: false };
  }

  const [inserted] = await tx
    .insert(practiceLocations)
    .values(values)
    .returning({ id: practiceLocations.id });
  if (!inserted) throw new AppError(ErrorCode.INTERNAL, "Location insert returned no row");
  return { id: inserted.id, created: true };
}
