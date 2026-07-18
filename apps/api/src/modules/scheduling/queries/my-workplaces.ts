/**
 * Clinic-side workplace list (Phase 8 dashboards): the doctor-locations
 * the session works at. Doctors resolve through the directory module's
 * published profile ref (§3.1); secretaries through this module's own
 * assignment rows. A user holding both roles gets the union, keyed on
 * doctor-location id with the owning relation winning.
 */
import { packOptionalText, packText } from "@mesomed/contracts/directory";
import type { z } from "zod";
import type { myWorkplacesOutputSchema } from "@mesomed/contracts/scheduling";
import {
  and,
  doctorLocations,
  eq,
  practiceLocations,
  secretaryAssignments,
  type DbExecutor,
} from "@mesomed/db/modules/scheduling";
import type { Session } from "../../../kernel/context.js";
import { getDoctorProfileIdForUser } from "../../directory/queries/doctor-profile-refs.js";

export type MyWorkplacesOutput = z.output<typeof myWorkplacesOutputSchema>;
type WorkplaceItem = MyWorkplacesOutput["workplaces"][number];

const workplaceColumns = {
  doctorLocationId: doctorLocations.id,
  doctorProfileId: doctorLocations.doctorProfileId,
  locationId: practiceLocations.id,
  slug: practiceLocations.slug,
  nameEn: practiceLocations.nameEn,
  nameAr: practiceLocations.nameAr,
  nameCkb: practiceLocations.nameCkb,
  addressEn: practiceLocations.addressEn,
  addressAr: practiceLocations.addressAr,
  addressCkb: practiceLocations.addressCkb,
  phone: practiceLocations.phone,
  timeZone: practiceLocations.timeZone,
  active: doctorLocations.active,
  locationActive: practiceLocations.active,
};

interface WorkplaceRow {
  doctorLocationId: string;
  doctorProfileId: string;
  locationId: string;
  slug: string;
  nameEn: string;
  nameAr: string;
  nameCkb: string;
  addressEn: string | null;
  addressAr: string | null;
  addressCkb: string | null;
  phone: string | null;
  timeZone: string;
  active: boolean;
  locationActive: boolean;
}

function toItem(row: WorkplaceRow, relation: WorkplaceItem["relation"]): WorkplaceItem {
  return {
    doctorLocationId: row.doctorLocationId,
    doctorProfileId: row.doctorProfileId,
    locationId: row.locationId,
    slug: row.slug,
    name: packText(row.nameEn, row.nameAr, row.nameCkb),
    address: packOptionalText(row.addressEn, row.addressAr, row.addressCkb),
    phone: row.phone,
    timeZone: row.timeZone,
    active: row.active,
    relation,
  };
}

export async function listMyWorkplaces(
  db: DbExecutor,
  session: Session,
): Promise<MyWorkplacesOutput> {
  const byId = new Map<string, WorkplaceItem>();

  if (session.roles.includes("secretary")) {
    const rows = await db
      .select(workplaceColumns)
      .from(secretaryAssignments)
      .innerJoin(doctorLocations, eq(doctorLocations.id, secretaryAssignments.doctorLocationId))
      .innerJoin(practiceLocations, eq(practiceLocations.id, doctorLocations.locationId))
      .where(
        and(
          eq(secretaryAssignments.secretaryUserId, session.userId),
          eq(secretaryAssignments.active, true),
        ),
      )
      .orderBy(practiceLocations.slug);
    for (const row of rows) {
      if (row.locationActive) byId.set(row.doctorLocationId, toItem(row, "assigned_secretary"));
    }
  }

  if (session.roles.includes("doctor")) {
    const doctorProfileId = await getDoctorProfileIdForUser(db, session.userId);
    if (doctorProfileId !== null) {
      const rows = await db
        .select(workplaceColumns)
        .from(doctorLocations)
        .innerJoin(practiceLocations, eq(practiceLocations.id, doctorLocations.locationId))
        .where(eq(doctorLocations.doctorProfileId, doctorProfileId))
        .orderBy(practiceLocations.slug);
      for (const row of rows) {
        if (row.locationActive) byId.set(row.doctorLocationId, toItem(row, "owning_doctor"));
      }
    }
  }

  return { workplaces: [...byId.values()] };
}
