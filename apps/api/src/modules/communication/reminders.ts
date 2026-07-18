/**
 * Next-day appointment reminders (MM-PLAN-001 §5 Phase 7): scans the
 * indexed `(status, starts_at)` window for tomorrow's still-active
 * appointments — an unbounded per-row scan is forbidden here (MM-ARC-002
 * §6.6). `planNotification`'s `dedupeKey` (`reminder:{appointmentId}:
 * {channel}`) makes a second run for the same day a no-op, so the cron
 * job is safe to redeliver or run twice.
 */
import type { Db } from "@mesomed/db/modules/communication";
import { listRemindableAppointments } from "../booking/queries/appointment-refs.js";
import { getDoctorDisplayName } from "../directory/queries/doctor-display-names.js";
import { getLocationNameForDoctorLocation } from "../scheduling/queries/location-names.js";
import { planNotification } from "./commands/plan-notification.js";
import { formatAppointmentDateTime, pickLocalizedName } from "./templates.js";

/** Iraq (Asia/Baghdad) has used a fixed UTC+3 offset with no DST since 2007. */
const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;

/** [start of tomorrow, start of the day after) in Baghdad wall-clock time, as UTC instants. */
export function baghdadTomorrowWindowUtc(now: Date): { fromUtc: Date; toUtc: Date } {
  const baghdadNow = new Date(now.getTime() + BAGHDAD_OFFSET_MS);
  const y = baghdadNow.getUTCFullYear();
  const m = baghdadNow.getUTCMonth();
  const d = baghdadNow.getUTCDate();
  return {
    fromUtc: new Date(Date.UTC(y, m, d + 1) - BAGHDAD_OFFSET_MS),
    toUtc: new Date(Date.UTC(y, m, d + 2) - BAGHDAD_OFFSET_MS),
  };
}

/** Plans a `reminder` notification for every remindable appointment starting tomorrow (Baghdad time). */
export async function planNextDayReminders(db: Db, now: Date): Promise<number> {
  const { fromUtc, toUtc } = baghdadTomorrowWindowUtc(now);
  const appointments = await listRemindableAppointments(db, fromUtc, toUtc);

  let planned = 0;
  for (const appointment of appointments) {
    const location = await getLocationNameForDoctorLocation(db, appointment.doctorLocationId);
    if (!location) continue;
    const doctorName = await getDoctorDisplayName(db, location.doctorProfileId);
    if (!doctorName) continue;

    const startsAtIso = appointment.startsAt.toISOString();
    const dateTime = formatAppointmentDateTime(startsAtIso);
    await planNotification(db, {
      patientProfileId: appointment.patientProfileId,
      appointmentId: appointment.appointmentId,
      template: "reminder",
      // No triggering event exists here (a direct cron call, not an event
      // subscriber) — appointment id + its CURRENT start time is the
      // occurrence key instead (ADR-0011 F-1): a same-day double cron run
      // sees the same startsAt and dedupes; a reschedule changes startsAt,
      // so the moved appointment gets a fresh reminder for its new time
      // instead of silently keeping (or losing) the stale one.
      occurrenceKey: `${appointment.appointmentId}:${startsAtIso}`,
      buildParams: (locale) => ({
        doctorName: pickLocalizedName(doctorName, locale),
        dateTime,
        locationName: pickLocalizedName(location, locale),
      }),
    });
    planned++;
  }
  return planned;
}
