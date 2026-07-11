export {
  ACTIVE_APPOINTMENT_STATUSES,
  APPOINTMENT_TRANSITIONS,
  assertTransition,
  canTransition,
  findSlotByStart,
  IllegalTransitionError,
  intervalsOverlap,
  RESCHEDULABLE_STATUSES,
  subtractBusyIntervals,
  type AppointmentStatus,
  type Interval,
} from "./transitions.js";
