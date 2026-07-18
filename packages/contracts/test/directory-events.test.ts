import { describe, expect, it } from "vitest";
import { createEventRegistry } from "../src/events/index.js";
import {
  DIRECTORY_EVENTS,
  doctorProfileCreatedV1,
  facilityCreatedV1,
  taxonomyChangedV1,
} from "../src/events/directory.js";

/**
 * MM-QA-004 F-18: directory was the only module without a pinned
 * event-set test — its contracts were registered only via the
 * composition root. Mirrors the identity/booking/clinical/billing pins.
 */
describe("directory event contracts", () => {
  it("exposes exactly the directory event set, all v1 (additive only)", () => {
    expect(DIRECTORY_EVENTS.map((event) => event.name).sort()).toEqual([
      "directory.doctor_profile_created.v1",
      "directory.doctor_profile_updated.v1",
      "directory.facility_created.v1",
      "directory.facility_updated.v1",
      "directory.taxonomy_changed.v1",
    ]);
  });

  it("registers cleanly into an event registry", () => {
    const registry = createEventRegistry(DIRECTORY_EVENTS);
    expect(registry.names()).toHaveLength(DIRECTORY_EVENTS.length);
  });

  it("facility_created round-trips a snapshot envelope", () => {
    const parsed = facilityCreatedV1.envelope.parse({
      name: "directory.facility_created.v1",
      version: 1,
      payload: facilityCreatedV1.payload.parse({
        facilityId: "f1",
        slug: "jeen-hospital",
        name: { en: "Jeen Hospital", ar: "مستشفى جين", ckb: "نەخۆشخانەی ژین" },
        categorySlug: "hospitals",
        citySlug: "erbil",
        publiclyVisible: true,
        tierRank: 1,
      }),
    });
    expect(parsed.version).toBe(1);
  });

  it("doctor_profile_created rejects a payload missing its specialty", () => {
    expect(() =>
      doctorProfileCreatedV1.payload.parse({
        doctorProfileId: "d1",
        slug: "dr-x",
        name: { en: "Dr X", ar: "د. س", ckb: "د. س" },
      }),
    ).toThrow();
  });

  it("taxonomy_changed accepts only its defined taxonomy/action values", () => {
    expect(
      taxonomyChangedV1.payload.parse({
        taxonomy: "specialty",
        entityId: "t1",
        key: "cardiology",
        action: "activated",
      }).taxonomy,
    ).toBe("specialty");
    expect(() =>
      taxonomyChangedV1.payload.parse({
        taxonomy: "galaxy",
        entityId: "t1",
        key: "x",
        action: "activated",
      }),
    ).toThrow();
  });
});
