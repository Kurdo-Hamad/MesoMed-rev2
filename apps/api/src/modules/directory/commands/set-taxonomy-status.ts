/**
 * Admin taxonomy gating (MM-PLAN-001 §5 Phase 3): activate/deactivate any
 * taxonomy row and feature/unfeature specialties, emitting
 * directory.taxonomy_changed.v1 transactionally.
 */
import type { z } from "zod";
import type {
  setSpecialtyFeaturedInputSchema,
  setTaxonomyStatusInputSchema,
} from "@mesomed/contracts/directory";
import { ErrorCode } from "@mesomed/contracts/errors";
import {
  categories,
  cities,
  eq,
  facilitySectionTypes,
  procedures,
  specialties,
  symptoms,
  type DbTransaction,
} from "@mesomed/db/modules/directory";
import { AppError } from "../../../kernel/errors.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";

type SetTaxonomyStatusInput = z.output<typeof setTaxonomyStatusInputSchema>;

/** Flip the row's active flag; returns the row id or undefined when absent. */
async function updateActive(
  tx: DbTransaction,
  input: SetTaxonomyStatusInput,
): Promise<string | undefined> {
  switch (input.taxonomy) {
    case "city": {
      const [row] = await tx
        .update(cities)
        .set({ active: input.active })
        .where(eq(cities.slug, input.key))
        .returning({ id: cities.id });
      return row?.id;
    }
    case "category": {
      const [row] = await tx
        .update(categories)
        .set({ active: input.active })
        .where(eq(categories.slug, input.key))
        .returning({ id: categories.id });
      return row?.id;
    }
    case "specialty": {
      const [row] = await tx
        .update(specialties)
        .set({ active: input.active, updatedAt: new Date() })
        .where(eq(specialties.key, input.key))
        .returning({ id: specialties.id });
      return row?.id;
    }
    case "symptom": {
      const [row] = await tx
        .update(symptoms)
        .set({ active: input.active })
        .where(eq(symptoms.slug, input.key))
        .returning({ id: symptoms.id });
      return row?.id;
    }
    case "procedure": {
      const [row] = await tx
        .update(procedures)
        .set({ active: input.active })
        .where(eq(procedures.slug, input.key))
        .returning({ id: procedures.id });
      return row?.id;
    }
    case "section_type": {
      const [row] = await tx
        .update(facilitySectionTypes)
        .set({ active: input.active })
        .where(eq(facilitySectionTypes.key, input.key))
        .returning({ id: facilitySectionTypes.id });
      return row?.id;
    }
  }
}

export async function setTaxonomyStatus(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: SetTaxonomyStatusInput,
): Promise<{ id: string }> {
  const id = await updateActive(tx, input);
  if (!id) {
    throw new AppError(ErrorCode.NOT_FOUND, `Unknown ${input.taxonomy} "${input.key}"`);
  }

  await outbox.emit(tx, {
    name: "directory.taxonomy_changed.v1",
    aggregateType: input.taxonomy,
    aggregateId: id,
    payload: {
      taxonomy: input.taxonomy,
      entityId: id,
      key: input.key,
      action: input.active ? "activated" : "deactivated",
    },
  });

  return { id };
}

export async function setSpecialtyFeatured(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: z.output<typeof setSpecialtyFeaturedInputSchema>,
): Promise<{ id: string }> {
  const [row] = await tx
    .update(specialties)
    .set({ featured: input.featured, updatedAt: new Date() })
    .where(eq(specialties.key, input.key))
    .returning({ id: specialties.id });
  if (!row) {
    throw new AppError(ErrorCode.NOT_FOUND, `Unknown specialty "${input.key}"`);
  }

  await outbox.emit(tx, {
    name: "directory.taxonomy_changed.v1",
    aggregateType: "specialty",
    aggregateId: row.id,
    payload: {
      taxonomy: "specialty",
      entityId: row.id,
      key: input.key,
      action: input.featured ? "featured" : "unfeatured",
    },
  });

  return { id: row.id };
}
