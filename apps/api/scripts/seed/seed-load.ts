/**
 * Load-test seeder (Phase 10 Slice 4, MM-DES-003 §6): fills a scratch
 * environment to launch-representative volume ×10 headroom, derived from
 * the D1 traffic ruling (300 bookings/day, ~1,500 sessions/day — owner
 * estimates, revisable):
 *
 *   doctors    2,000   (~200 listed at launch × 10)
 *   locations    400   (5 doctors per location)
 *   schedules  2,000   (every doctor-location, 9:00–17:00, 30-min slots)
 *   patients  50,000   (~5,000 early profiles × 10)
 *   appts    270,000   (90 days × 3,000/day — the 10× daily volume)
 *   secretaries   50   (credentialed, for the auth'd clinic-day scenario)
 *
 * Deterministic: a seeded PRNG (mulberry32), fixed slugs/ids/phones — two
 * runs produce the same database. Idempotent via a volume marker (skips
 * when the doctor count is already at target). Refuses NODE_ENV=production
 * like the demo seed.
 *
 * Directory/search read models are populated the honest way: doctors go
 * through the real upsertDoctorProfile command and the outbox is drained,
 * so browse/search queries under load read real read-model rows. Bulk
 * history (patients, appointments) is direct-inserted — it has no read
 * model and the command path would take hours for 270k rows.
 *
 * Bundled into dist/ (tsup entry) so it can run co-located with the
 * scratch database; run it as a pre-start step, never in production.
 */
import { doctorProfiles, patientProfiles, user, userRoles } from "@mesomed/db";
import { buildServer } from "../../src/app.js";
import { loadEnv } from "../../src/env.js";
import { assignSecretary } from "../../src/modules/scheduling/commands/assign-secretary.js";
import { linkDoctorLocation } from "../../src/modules/scheduling/commands/link-doctor-location.js";
import { setWeeklySchedule } from "../../src/modules/scheduling/commands/set-weekly-schedule.js";
import { upsertLocation } from "../../src/modules/scheduling/commands/upsert-location.js";
import { upsertDoctorProfile } from "../../src/modules/directory/commands/upsert-doctor-profile.js";
import { appointments, domainEvents, inArray, sql } from "@mesomed/db";
import { seedDirectory } from "./seed-directory.js";
import { seedUuid } from "./seed-uuid.js";

const TARGET_DOCTORS = 2_000;
const TARGET_LOCATIONS = 400;
const TARGET_PATIENTS = 50_000;
const TARGET_APPOINTMENTS = 270_000;
const TARGET_SECRETARIES = 50;
const HISTORY_DAYS = 90;
export const LOAD_SECRETARY_PASSWORD = "LoadTest!Secretary42";

/** Deterministic PRNG — the whole seed is reproducible from this constant. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Must be subsets of the demo seed's config rows (scripts/seed/data.ts).
const CITY_SLUGS = ["erbil", "sulaymaniyah", "duhok", "halabja", "zakho", "soran"];
const SPECIALTIES = [
  "cardiology",
  "dermatology",
  "pediatrics",
  "orthopedics",
  "neurology",
  "gynecology",
  "ent",
  "ophthalmology",
  "dentistry",
  "general_medicine",
];

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to load-seed a production environment");
  }
  const app = await buildServer(env);
  const { db, config, outbox, dispatcher } = app.kernel;
  const log = (message: string) => console.log(`[seed-load] ${message}`);

  try {
    const [marker] = await db.select({ n: sql<number>`count(*)::int` }).from(doctorProfiles);
    if ((marker?.n ?? 0) >= TARGET_DOCTORS) {
      log(`marker hit (${marker?.n} doctors) — inserts done, ensuring outbox is drained`);
      await drainOutbox();
      return;
    }

    log("base config via seedDirectory...");
    await seedDirectory({ db, config, outbox, log });

    const rand = mulberry32(0x5eed_1004);

    // ── Locations ──────────────────────────────────────────────────────
    log(`${TARGET_LOCATIONS} locations...`);
    const locationIds: string[] = [];
    for (let i = 0; i < TARGET_LOCATIONS; i++) {
      await db.transaction(async (tx) => {
        const loc = await upsertLocation(tx, {
          slug: `load-clinic-${i}`,
          name: {
            en: `Load Clinic ${i}`,
            ar: `عيادة الاختبار ${i}`,
            ckb: `کلینیکی تاقی ${i}`,
          },
          timeZone: "Asia/Baghdad",
          active: true,
        });
        locationIds.push(loc.id);
      });
    }

    // ── Doctors + links + schedules ────────────────────────────────────
    log(`${TARGET_DOCTORS} doctor listings + links + weekly schedules...`);
    const doctorLocationIds: string[] = [];
    for (let i = 0; i < TARGET_DOCTORS; i++) {
      const specialty = SPECIALTIES[i % SPECIALTIES.length]!;
      const city = CITY_SLUGS[i % CITY_SLUGS.length]!;
      await db.transaction(async (tx) => {
        const doctor = await upsertDoctorProfile(tx, outbox, {
          id: seedUuid("3", 10_000 + i),
          slug: `load-doctor-${i}`,
          name: {
            en: `Dr. Load ${specialty.replace("_", " ")} ${i}`,
            ar: `د. اختبار ${i}`,
            ckb: `د. تاقیکردنەوە ${i}`,
          },
          bio: {
            en: `Load-test ${specialty.replace("_", " ")} profile ${i}.`,
            ar: `ملف اختبار ${i}.`,
            ckb: `پرۆفایلی تاقیکردنەوە ${i}.`,
          },
          specialtyKey: specialty,
          citySlug: city,
          active: true,
        });
        const link = await linkDoctorLocation(tx, {
          doctorProfileId: doctor.id,
          locationId: locationIds[i % TARGET_LOCATIONS]!,
          active: true,
        });
        doctorLocationIds.push(link.doctorLocationId);
        await setWeeklySchedule(tx, {
          doctorLocationId: link.doctorLocationId,
          schedules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
            dayOfWeek,
            startTime: "09:00",
            endTime: "17:00",
            slotDurationMinutes: 30,
            breaks: [{ startTime: "12:00", endTime: "13:00" }],
          })),
        });
      });
      if ((i + 1) % 250 === 0) log(`  ${i + 1} doctors`);
    }

    // ── Patients (bulk) ────────────────────────────────────────────────
    log(`${TARGET_PATIENTS} patient profiles (bulk)...`);
    const patientIds: string[] = [];
    for (let base = 0; base < TARGET_PATIENTS; base += 2_000) {
      const batch = Array.from({ length: Math.min(2_000, TARGET_PATIENTS - base) }, (_, j) => {
        const n = base + j;
        return {
          id: seedUuid("4", 100_000 + n),
          normalizedPhone: `+96475${String(1_000_000 + n).padStart(8, "0")}`,
          fullName: `Load Patient ${n}`,
        };
      });
      await db.insert(patientProfiles).values(batch).onConflictDoNothing();
      patientIds.push(...batch.map((p) => p.id));
      if ((base + 2_000) % 10_000 === 0) log(`  ${base + 2_000} patients`);
    }

    // ── Historical appointments (bulk, 90 days back) ───────────────────
    // Deterministic slot allocation guarantees the partial unique index
    // (one non-cancelled appointment per doctor-location + start instant)
    // is respected by construction: each (dl, day, slot) triple is used
    // at most once.
    log(`${TARGET_APPOINTMENTS} historical appointments (bulk)...`);
    const SLOTS_PER_DAY = 14; // 9:00–17:00 minus the 12–13 break, 30-min
    const dayMs = 24 * 60 * 60 * 1000;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    let inserted = 0;
    let batch: (typeof appointments.$inferInsert)[] = [];
    outer: for (let day = 1; day <= HISTORY_DAYS; day++) {
      const dayStart = new Date(today.getTime() - day * dayMs);
      for (let d = 0; d < TARGET_DOCTORS; d++) {
        // ~9.4% of slot-days are filled → ~1.5 bookings/doctor/day.
        for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
          if (rand() > 0.107) continue;
          const hour = slot < 6 ? 9 + Math.floor(slot / 2) : 13 + Math.floor((slot - 6) / 2);
          const minute = slot % 2 === 0 ? 0 : 30;
          // Baghdad wall clock (UTC+3, fixed since 2007) → UTC instant.
          const startsAt = new Date(dayStart.getTime() + ((hour - 3) * 60 + minute) * 60 * 1000);
          const r = rand();
          const status =
            r < 0.7 ? "completed" : r < 0.85 ? "cancelled" : r < 0.95 ? "no_show" : "confirmed";
          batch.push({
            id: seedUuid("5", 1_000_000 + inserted),
            doctorLocationId: doctorLocationIds[d]!,
            patientProfileId: patientIds[Math.floor(rand() * patientIds.length)]!,
            startsAt,
            endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000),
            status,
            bookedVia: rand() < 0.6 ? "guest_web" : "secretary_walk_in",
            cancellationReason: status === "cancelled" ? "load-seed cancellation" : null,
            createdAt: new Date(startsAt.getTime() - dayMs),
            statusChangedAt: startsAt,
          });
          inserted++;
          if (batch.length >= 1_000) {
            await db.insert(appointments).values(batch).onConflictDoNothing();
            batch = [];
            if (inserted % 25_000 < 1_000) log(`  ${inserted} appointments`);
          }
          if (inserted >= TARGET_APPOINTMENTS) break outer;
        }
      }
    }
    if (batch.length > 0) await db.insert(appointments).values(batch).onConflictDoNothing();
    log(`  ${inserted} appointments inserted`);

    // ── Secretaries (credentialed, for the auth'd polling scenario) ────
    log(`${TARGET_SECRETARIES} secretary accounts...`);
    for (let s = 0; s < TARGET_SECRETARIES; s++) {
      const email = `load-secretary-${s}@loadtest.mesomed.example`;
      await app.identity.auth.api
        .signUpEmail({
          body: { email, password: LOAD_SECRETARY_PASSWORD, name: `Load Secretary ${s}` },
        })
        .catch((error: unknown) => {
          // Idempotent re-run: the account already exists.
          if (!String(error).includes("already exists")) throw error;
        });
      const [row] = await db
        .select({ id: user.id })
        .from(user)
        .where(sql`email = ${email}`);
      if (!row) throw new Error(`secretary ${email} did not persist`);
      await db
        .update(user)
        .set({ emailVerified: true })
        .where(sql`id = ${row.id}`);
      await db
        .insert(userRoles)
        .values({ userId: row.id, role: "secretary" })
        .onConflictDoNothing();
      await db.transaction(async (tx) => {
        await assignSecretary(tx, {
          secretaryUserId: row.id,
          doctorLocationId: doctorLocationIds[s]!,
          active: true,
        });
      });
    }

    await drainOutbox();
    log("seed complete.");
  } finally {
    await app.close();
  }

  // Drain synchronously via redeliver() instead of pump-and-wait: the
  // pg-boss workers pull one job per poll interval, which for thousands
  // of seed events means hours (the ADR-0007 drain-timeout failure mode);
  // direct redelivery is idempotent (processed_events claims) and runs
  // the handlers inline in minutes. Queued pg-boss duplicates no-op.
  async function drainOutbox(): Promise<void> {
    log("draining outbox into read models (direct redeliver)...");
    const deadline = Date.now() + 15 * 60_000;
    let drained = 0;
    for (;;) {
      const open = await db
        .select({ id: domainEvents.id })
        .from(domainEvents)
        .where(inArray(domainEvents.status, ["pending", "published"]))
        .limit(500);
      if (open.length === 0) break;
      for (const { id } of open) {
        await dispatcher.redeliver(id);
        drained++;
      }
      if (drained % 2_000 < 500) log(`  ${drained} events drained`);
      if (Date.now() > deadline) {
        throw new Error("Outbox did not drain within 15 min — check dispatcher logs");
      }
    }
    log(`outbox drained (${drained} events this run)`);
  }
}

main()
  .then(() => {
    // Explicit exit: buildServer's pools/schedulers keep handles alive even
    // after app.close(), and a lingering seed process blocks the chained
    // API start (`node dist/seed-load.js && node dist/main.js`).
    console.log("[seed-load] done, exiting");
    process.exit(0);
  })
  .catch((error) => {
    console.error("[seed-load] failed:", error);
    process.exit(1);
  });
