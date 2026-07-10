/**
 * Search module assembly (MM-PLAN-001 §2, §5 Phase 3): subscribes the
 * read-model indexers to the directory's entity events.
 */
import type { HandlerRegistry } from "../../kernel/events.js";
import {
  INDEX_DOCTOR_HANDLER,
  INDEX_FACILITY_HANDLER,
  indexDoctorDocument,
  indexFacilityDocument,
} from "./events/index-documents.js";

export function registerSearchSubscribers(events: HandlerRegistry): void {
  events.on("directory.facility_created.v1", INDEX_FACILITY_HANDLER, indexFacilityDocument);
  events.on("directory.facility_updated.v1", INDEX_FACILITY_HANDLER, indexFacilityDocument);
  events.on("directory.doctor_profile_created.v1", INDEX_DOCTOR_HANDLER, indexDoctorDocument);
  events.on("directory.doctor_profile_updated.v1", INDEX_DOCTOR_HANDLER, indexDoctorDocument);
}
