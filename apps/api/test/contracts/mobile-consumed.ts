/**
 * Procedures the mobile app calls today — extend when a new screen
 * consumes a new procedure (generated from `grep -rhoE 'trpc\.[a-zA-Z]+\.
 * [a-zA-Z]+' apps/mobile/app apps/mobile/lib`; pinned literally here the
 * same way the authz MATRIX pins its list). Kept in a plain module (not a
 * `.test.ts` file) so importing it — e.g. from mobile-consumed-pin.test.ts
 * — never re-executes router-schema-surface.test.ts's own describe/it
 * blocks under the importing file (vitest gives every imported test file
 * its own module scope, so a `.test.ts`-to-`.test.ts` import double-runs
 * the imported file's tests).
 */
export const MOBILE_CONSUMED = [
  "ai.triageSymptoms",
  "booking.cancel",
  "booking.checkIn",
  "booking.clinicDay",
  "booking.complete",
  "booking.confirm",
  "booking.delay",
  "booking.guestBook",
  "booking.myAppointments",
  "booking.noShow",
  "booking.recall",
  "booking.start",
  "booking.weekAvailability",
  "clinical.addReportedMedication",
  "clinical.encounterNotes",
  "clinical.myClinicalRecord",
  "clinical.myEncounters",
  "clinical.removeReportedMedication",
  "clinical.upsertMedicalProfile",
  "communication.registerDeviceToken",
  "communication.unregisterDeviceToken",
  "directory.browseDoctors",
  "directory.browseFacilities",
  "directory.doctorDetail",
  "directory.facilityDetail",
  "directory.homepageFeed",
  "directory.listCategories",
  "directory.listCities",
  "directory.listSpecialties",
  "identity.deleteAccount",
  "identity.me",
  "scheduling.doctorLocations",
  "scheduling.myWorkplaces",
  "search.listings",
] as const;
