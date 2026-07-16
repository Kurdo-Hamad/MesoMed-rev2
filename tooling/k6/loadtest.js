/**
 * Phase 10 Slice 4 load test (MM-DES-003 §6, rulings D1/D2 — ADR-0030).
 *
 * Traffic model, derived from D1 (300 bookings/day, ~1,500 directory
 * sessions/day, ~25 peak concurrent at 1×; ×10 = 3,000 / 15,000 / ~250):
 * arrival rates model the PEAK HOUR of the target day (15% of daily
 * volume in one hour); VUs are capped at 250 (D1's 10× concurrency —
 * never exceeded, spike included).
 *
 *   INTENSITY=1  → 0.0625 sessions/s, 0.0125 bookings/s,  5 clinic pollers
 *   INTENSITY=10 → 0.625  sessions/s, 0.125  bookings/s, 50 clinic pollers
 *   SPIKE=1      → adds a 2-min burst at 2× the arrival rates
 *
 * Env: BASE_URL, K6_DATA (JSON: {doctorLocations:[], secretaries:[{email,
 * password, doctorLocationId}]}), INTENSITY, DURATION (e.g. "20m"), SPIKE.
 *
 * Pass criteria (§6, ratified in D1): p95 read < 500 ms, p95 booking
 * command < 1 s, real-error rate < 0.1% (typed SLOT_UNAVAILABLE conflicts
 * are correct behavior, tracked separately, not errors), zero
 * double-bookings (asserted in the DB after the run), outbox lag recovery
 * (watched from the DB after the run).
 */
import { check, sleep } from "k6";
import http from "k6/http";
import { Counter, Rate } from "k6/metrics";
import {
  trpcQuery,
  trpcMutation,
  trpcData,
  trpcErrorCode,
  loadData,
  uniquePhone,
  BASE,
} from "./lib.js";

const realErrors = new Rate("real_errors");
const slotConflicts = new Counter("slot_conflicts");
const bookingsCreated = new Counter("bookings_created");

const INTENSITY = Number(__ENV.INTENSITY ?? 1);
const DURATION = __ENV.DURATION ?? "15m";
const SPIKE = __ENV.SPIKE === "1";

const sessionRate = 0.0625 * INTENSITY; // sessions/s (peak hour of the day)
const bookingRate = 0.0125 * INTENSITY; // bookings/s
const pollers = 5 * INTENSITY; // concurrent clinic screens

const scenarios = {
  directory: {
    executor: "constant-arrival-rate",
    exec: "directorySession",
    rate: Math.max(1, Math.round(sessionRate * 100)),
    timeUnit: "100s",
    duration: DURATION,
    preAllocatedVUs: Math.min(30 * INTENSITY, 120),
    maxVUs: 150,
  },
  booking: {
    executor: "constant-arrival-rate",
    exec: "guestBooking",
    rate: Math.max(1, Math.round(bookingRate * 100)),
    timeUnit: "100s",
    duration: DURATION,
    preAllocatedVUs: Math.min(5 * INTENSITY, 30),
    maxVUs: 40,
  },
  clinicDay: {
    executor: "constant-vus",
    exec: "clinicPoll",
    vus: pollers,
    // POLL_DURATION covers the spike window too when SPIKE=1.
    duration: __ENV.POLL_DURATION ?? DURATION,
  },
};

if (SPIKE) {
  scenarios.directorySpike = {
    executor: "constant-arrival-rate",
    exec: "directorySession",
    rate: Math.max(1, Math.round(sessionRate * 2 * 100)),
    timeUnit: "100s",
    duration: "2m",
    startTime: DURATION,
    preAllocatedVUs: 40,
    maxVUs: 55, // total across scenarios stays under the D1 250-VU cap
  };
  scenarios.bookingSpike = {
    executor: "constant-arrival-rate",
    exec: "guestBooking",
    rate: Math.max(1, Math.round(bookingRate * 2 * 100)),
    timeUnit: "100s",
    duration: "2m",
    startTime: DURATION,
    preAllocatedVUs: 5,
    maxVUs: 5,
  };
}

export const options = {
  scenarios,
  // Keep each VU's session cookie across iterations (k6 resets the jar
  // between iterations by default, which forced a re-login per poll).
  noCookiesReset: true,
  thresholds: {
    "http_req_duration{kind:read}": ["p(95)<500"],
    "http_req_duration{kind:book}": ["p(95)<1000"],
    real_errors: ["rate<0.001"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

const data = loadData();
const CITIES = ["erbil", "sulaymaniyah", "duhok", "halabja", "zakho", "soran"];
const SPECIALTIES = ["cardiology", "dermatology", "pediatrics", "orthopedics", "neurology"];

export function directorySession() {
  const read = { tags: { kind: "read" } };
  const city = CITIES[Math.floor(Math.random() * CITIES.length)];
  const specialty = SPECIALTIES[Math.floor(Math.random() * SPECIALTIES.length)];

  const browse = trpcQuery("directory.browseDoctors", { citySlug: city, limit: 12 }, read);
  check(browse, { "browse 200": (r) => r.status === 200 });
  realErrors.add(browse.status !== 200);
  sleep(2 + Math.random() * 6);

  const bySpecialty = trpcQuery(
    "directory.browseDoctors",
    { specialtyKey: specialty, citySlug: city, limit: 12 },
    read,
  );
  realErrors.add(bySpecialty.status !== 200);
  const cards = trpcData(bySpecialty)?.items ?? [];
  sleep(2 + Math.random() * 6);

  const card = Array.isArray(cards) && cards.length > 0 ? cards[0] : undefined;
  if (card?.slug) {
    const detail = trpcQuery("directory.doctorDetail", { slugOrId: card.slug }, read);
    realErrors.add(detail.status !== 200);
    sleep(3 + Math.random() * 7);
  }

  if (Math.random() < 0.3) {
    const search = trpcQuery(
      "search.listings",
      { query: "Load " + specialty.slice(0, 4), limit: 12 },
      read,
    );
    realErrors.add(search.status !== 200);
    sleep(2 + Math.random() * 4);
  }

  if (Math.random() < 0.5) {
    const dl = data.doctorLocations[Math.floor(Math.random() * data.doctorLocations.length)];
    const avail = trpcQuery(
      "booking.weekAvailability",
      { doctorLocationId: dl, anchor: new Date(Date.now() + 7 * 86400000).toISOString() },
      read,
    );
    realErrors.add(avail.status !== 200);
  }
  // Idle tail: the user reads the page; a sleeping VU models a connected,
  // inactive concurrent user without generating server load.
  sleep(20 + Math.random() * 40);
}

export function guestBooking() {
  const dl = data.doctorLocations[Math.floor(Math.random() * data.doctorLocations.length)];
  const avail = trpcQuery(
    "booking.weekAvailability",
    { doctorLocationId: dl, anchor: new Date(Date.now() + 7 * 86400000).toISOString() },
    { tags: { kind: "read" } },
  );
  realErrors.add(avail.status !== 200);
  const days = trpcData(avail)?.days ?? [];
  const slots = days.filter((d) => !d.isPast).flatMap((d) => d.slots);
  if (slots.length === 0) return;

  const slot = slots[Math.floor(Math.random() * Math.min(slots.length, 40))];
  sleep(1 + Math.random() * 3);
  const res = trpcMutation(
    "booking.guestBook",
    {
      doctorLocationId: dl,
      startsAt: slot.startsAt,
      patient: { fullName: `Load Guest ${__VU}-${__ITER}`, phone: uniquePhone(__VU, __ITER) },
    },
    { tags: { kind: "book" } },
  );
  if (res.status === 200) {
    bookingsCreated.add(1);
    realErrors.add(false);
  } else if (trpcErrorCode(res) === "SLOT_UNAVAILABLE") {
    // Two guests raced for one slot and the invariant held — correct
    // behavior, not an error (§6).
    slotConflicts.add(1);
    realErrors.add(false);
  } else {
    realErrors.add(true);
  }
}

const sessionCookies = {};

export function clinicPoll() {
  const secretary = data.secretaries[(__VU - 1) % data.secretaries.length];
  if (!sessionCookies[__VU]) {
    const login = http.post(
      `${BASE}/api/auth/sign-in/email`,
      JSON.stringify({ email: secretary.email, password: secretary.password }),
      { headers: { "content-type": "application/json" } },
    );
    check(login, { "sign-in 200": (r) => r.status === 200 });
    realErrors.add(login.status !== 200);
    sessionCookies[__VU] = true; // cookie jar is per-VU; flag avoids re-login
    if (login.status !== 200) {
      sleep(10);
      return;
    }
  }
  const res = trpcQuery(
    "booking.clinicDay",
    { doctorLocationId: secretary.doctorLocationId },
    { tags: { kind: "read" } },
  );
  check(res, { "clinicDay 200": (r) => r.status === 200 });
  realErrors.add(res.status !== 200);
  sleep(10);
}

