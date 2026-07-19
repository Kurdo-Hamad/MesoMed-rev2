/**
 * Admin doctor-profile upsert (MM-PLAN-001 §5 Phase 3). Keyed by slug;
 * validates the specialty key, recomputes public visibility and emits
 * directory.doctor_profile_created/updated.v1 transactionally (§3.2).
 */
import type { z } from "zod";
import type { upsertDoctorProfileInputSchema } from "@mesomed/contracts/directory";
import { ErrorCode } from "@mesomed/contracts/errors";
import {
  doctorProfiles,
  eq,
  providers,
  specialties,
  type DbTransaction,
} from "@mesomed/db/modules/directory";
import { AppError } from "../../../kernel/errors.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import { isProviderProfileApproved } from "../../identity/queries/provider-visibility.js";
import { countryIsoForCity, doctorPubliclyVisible, packText, requireCityId } from "../shared.js";

export type UpsertDoctorProfileInput = z.output<typeof upsertDoctorProfileInputSchema> & {
  /** Deterministic id for seed/import creates — never exposed via tRPC. */
  id?: string;
};

export async function upsertDoctorProfile(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: UpsertDoctorProfileInput,
): Promise<{ id: string; created: boolean }> {
  const [specialty] = await tx
    .select({ key: specialties.key })
    .from(specialties)
    .where(eq(specialties.key, input.specialtyKey));
  if (!specialty) {
    throw new AppError(ErrorCode.VALIDATION, `Unknown specialty "${input.specialtyKey}"`);
  }
  const cityId = input.citySlug ? await requireCityId(tx, input.citySlug) : null;

  const [existing] = await tx
    .select({ id: doctorProfiles.id, providerId: doctorProfiles.providerId })
    .from(doctorProfiles)
    .where(eq(doctorProfiles.slug, input.slug))
    .for("update");

  let providerId: string;
  if (existing) {
    providerId = existing.providerId;
  } else {
    const approved = input.identityProfileId
      ? await isProviderProfileApproved(tx, input.identityProfileId)
      : true;
    const [provider] = await tx
      .insert(providers)
      .values({
        providerType: "doctor",
        identityProfileId: input.identityProfileId ?? null,
        approved,
      })
      .returning({ id: providers.id });
    if (!provider) throw new AppError(ErrorCode.INTERNAL, "Provider insert returned no row");
    providerId = provider.id;
  }

  const [provider] = await tx
    .select({
      approved: providers.approved,
      identityProfileId: providers.identityProfileId,
      subscriptionActive: providers.subscriptionActive,
    })
    .from(providers)
    .where(eq(providers.id, providerId));
  const publiclyVisible = provider !== undefined && doctorPubliclyVisible(provider, input.active);

  const values = {
    providerId,
    slug: input.slug,
    nameEn: input.name.en,
    nameAr: input.name.ar,
    nameCkb: input.name.ckb,
    bioEn: input.bio?.en ?? null,
    bioAr: input.bio?.ar ?? null,
    bioCkb: input.bio?.ckb ?? null,
    specialtyKey: input.specialtyKey,
    cityId,
    photoUrl: input.photoUrl ?? null,
    active: input.active,
    publiclyVisible,
    updatedAt: new Date(),
  };

  let doctorProfileId: string;
  if (existing) {
    await tx.update(doctorProfiles).set(values).where(eq(doctorProfiles.id, existing.id));
    doctorProfileId = existing.id;
  } else {
    const [inserted] = await tx
      .insert(doctorProfiles)
      .values(input.id ? { id: input.id, ...values } : values)
      .returning({ id: doctorProfiles.id });
    if (!inserted) throw new AppError(ErrorCode.INTERNAL, "Doctor profile insert returned no row");
    doctorProfileId = inserted.id;
  }

  await outbox.emit(tx, {
    name: existing ? "directory.doctor_profile_updated.v1" : "directory.doctor_profile_created.v1",
    aggregateType: "doctor_profile",
    aggregateId: doctorProfileId,
    payload: {
      doctorProfileId,
      slug: input.slug,
      name: packText(input.name.en, input.name.ar, input.name.ckb),
      specialtyKey: input.specialtyKey,
      citySlug: input.citySlug ?? null,
      countryIso: await countryIsoForCity(tx, cityId),
      publiclyVisible,
    },
  });

  return { id: doctorProfileId, created: !existing };
}
