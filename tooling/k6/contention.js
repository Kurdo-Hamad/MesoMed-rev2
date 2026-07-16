/**
 * Same-slot contention burst (MM-DES-003 §6 scenario b, ADR-0030): every
 * VU fires guestBook at the IDENTICAL slot simultaneously; the partial
 * unique index must let exactly one through per slot. 5 bursts × 20 VUs
 * over 5 consecutive slots; the DB assertion afterwards checks each slot
 * holds exactly one non-cancelled appointment.
 *
 * Env: BASE_URL, K6_DATA with {contention: {doctorLocationId, slotStarts:
 * [iso, ...]}} — 5 known-open future slots supplied by the runner.
 */
import { Counter } from "k6/metrics";
import { trpcMutation, trpcErrorCode, loadData, uniquePhone } from "./lib.js";

const wins = new Counter("contention_wins");
const conflicts = new Counter("contention_conflicts");
const unexpected = new Counter("contention_unexpected");

export const options = {
  scenarios: {
    contention: {
      executor: "per-vu-iterations",
      vus: 20,
      iterations: 5,
      maxDuration: "3m",
    },
  },
  thresholds: {
    contention_unexpected: ["count==0"],
  },
};

const data = loadData();

export default function () {
  const slot = data.contention.slotStarts[__ITER];
  const res = trpcMutation("booking.guestBook", {
    doctorLocationId: data.contention.doctorLocationId,
    startsAt: slot,
    patient: {
      fullName: `Contention VU${__VU}`,
      phone: uniquePhone(500 + __VU, __ITER),
    },
  });
  if (res.status === 200) wins.add(1);
  else if (trpcErrorCode(res) === "SLOT_UNAVAILABLE") conflicts.add(1);
  else unexpected.add(1);
}

