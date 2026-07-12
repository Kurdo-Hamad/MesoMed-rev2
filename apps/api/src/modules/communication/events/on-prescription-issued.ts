/**
 * Prescription-issued subscriber (MM-PLAN-001 §5 Phase 7, ADR-0010): the
 * event carries identifiers only — never medication content (clinical's
 * own privacy invariant, §3.5). This handler notifies the patient with the
 * issuing doctor's name only; no visit/medication data ever reaches a
 * notification template or the `notification_log` table.
 */
import type { EventEnvelope, prescriptionIssuedV1 } from "@mesomed/contracts";
import type { EventHandlerFn } from "../../../kernel/events.js";
import { getDoctorDisplayName } from "../../directory/queries/doctor-display-names.js";
import { planNotification } from "../commands/plan-notification.js";
import { pickLocalizedName } from "../templates.js";

export const ON_PRESCRIPTION_ISSUED_HANDLER = "communication.plan-prescription-notice";

export const onPrescriptionIssued: EventHandlerFn = async (envelope, tx, eventId) => {
  const { payload } = envelope as EventEnvelope<typeof prescriptionIssuedV1>;
  const doctorName = await getDoctorDisplayName(tx, payload.doctorProfileId);
  if (!doctorName) return;

  await planNotification(tx, {
    patientProfileId: payload.patientProfileId,
    appointmentId: null,
    template: "prescription_issued",
    // The triggering event's own id — see ADR-0011 F-1. Without this, a
    // patient's SECOND-ever prescription notice (any doctor, any time)
    // silently planned nothing: the old key was patientProfileId-only, so
    // every prescription for that patient collided on the first one.
    occurrenceKey: eventId,
    buildParams: (locale) => ({ doctorName: pickLocalizedName(doctorName, locale) }),
  });
};
