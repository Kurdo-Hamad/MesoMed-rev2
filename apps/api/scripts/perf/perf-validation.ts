/**
 * Phase 3 perf gate (MM-PLAN-001 §5): bulk-load ~200k synthetic facilities,
 * then measure p95 latency of the keyset browse and the trigram search
 * THROUGH THE REAL tRPC PROCEDURES (router + context + Zod + query), not
 * bare SQL. Ported from the old repo's perf-explain approach, extended with
 * the latency harness. Dev-only throwaway; never a migration or seed.
 *
 * Usage:
 *   pnpm --filter @mesomed/api perf            # embedded disposable PG16
 *   PERF_DATABASE_URL=postgres://… pnpm perf   # your own LOCAL database
 *
 * Refuses to run against anything that looks hosted/production.
 */
import type { FastifyInstance } from "fastify";
import { sql } from "@mesomed/db";
import { createTestDatabase } from "@mesomed/db/testing";
import { buildServer } from "../../src/app.js";
import { loadEnv } from "../../src/env.js";

const TARGET_ROWS = 200_000;
const SAMPLES = 300;
const BUDGET_MS = 100;

async function main(): Promise<void> {
  const explicitUrl = process.env.PERF_DATABASE_URL;
  if (
    explicitUrl &&
    /supabase\.co|supabase\.com|pooler|amazonaws|azure|railway|fly\.io/.test(explicitUrl)
  ) {
    throw new Error("Refusing to run: PERF_DATABASE_URL looks like a hosted/production database.");
  }

  const tdb = explicitUrl ? null : await createTestDatabase();
  const connectionString = explicitUrl ?? tdb!.connectionString;
  console.log(`Perf database: ${explicitUrl ? "PERF_DATABASE_URL" : "embedded disposable PG16"}`);

  const app = await buildServer(
    loadEnv({
      ...process.env,
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: connectionString,
      BETTER_AUTH_SECRET: "perf-secret-perf-secret-perf-secret-0000",
    }),
  );
  const { db, config } = app.kernel;

  try {
    console.log("Staging fixtures + gating config...");
    await config.set(
      // Local shape of the gating schema — avoids importing zod twice.
      (await import("@mesomed/config")).countryGatingSchema,
      (await import("@mesomed/config")).COUNTRY_GATING_CONFIG_KEY,
      { IQ: "active" },
    );
    await db.execute(sql`
      INSERT INTO countries (id, slug, iso_code, name_en, name_ar, name_ckb)
      VALUES ('00000000-0000-4000-9a00-000000000001', 'iraq', 'IQ', 'Iraq', 'العراق', 'عێراق')
      ON CONFLICT (slug) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO cities (id, slug, country_id, name_en, name_ar, name_ckb)
      VALUES
        ('00000000-0000-4000-9b00-000000000001', 'erbil', '00000000-0000-4000-9a00-000000000001', 'Erbil', 'أربيل', 'هەولێر'),
        ('00000000-0000-4000-9b00-000000000002', 'sulaymaniyah', '00000000-0000-4000-9a00-000000000001', 'Sulaymaniyah', 'السليمانية', 'سلێمانی'),
        ('00000000-0000-4000-9b00-000000000003', 'duhok', '00000000-0000-4000-9a00-000000000001', 'Duhok', 'دهوك', 'دهۆک')
      ON CONFLICT (slug) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO categories (id, slug, name_en, name_ar, name_ckb)
      VALUES
        ('00000000-0000-4000-9c00-000000000001', 'hospital', 'Hospitals', 'المستشفيات', 'نەخۆشخانەکان'),
        ('00000000-0000-4000-9c00-000000000002', 'dental_clinic', 'Dental Clinics', 'عيادات الأسنان', 'کلینیکەکانی ددان'),
        ('00000000-0000-4000-9c00-000000000003', 'beauty_center', 'Beauty Centers', 'مراكز التجميل', 'سەنتەرەکانی جوانکاری')
      ON CONFLICT (slug) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO providers (id, provider_type, approved)
      VALUES ('00000000-0000-4000-9d00-000000000001', 'hospital', true)
      ON CONFLICT DO NOTHING`);

    const existing = await db.execute(sql`SELECT count(*)::int AS n FROM facilities`);
    const have = (existing.rows[0] as { n: number }).n;
    const need = TARGET_ROWS - have;
    if (need > 0) {
      console.log(`Bulk-generating ${need} synthetic facilities (set-based INSERT … SELECT)...`);
      // Distribution ported from perf-explain: 3 categories × 3 cities,
      // tier mix 5%/15%/80%, 90% publicly visible.
      await db.execute(sql`
        INSERT INTO facilities (
          provider_id, category_id, slug, name_en, name_ar, name_ckb, city_id,
          active, publicly_visible, tier_rank
        )
        SELECT
          '00000000-0000-4000-9d00-000000000001',
          c.id,
          'perf-' || g,
          'Perf Facility ' || md5(g::text),
          'منشأة ' || md5(g::text),
          'دامەزراوە ' || md5(g::text),
          ci.id,
          true,
          (g % 10) <> 0,
          CASE WHEN g % 100 < 5 THEN 1 WHEN g % 100 < 20 THEN 2 ELSE 3 END
        FROM generate_series(1, ${sql.raw(String(need))}) AS g
        JOIN LATERAL (
          SELECT id FROM categories ORDER BY slug OFFSET (g % 3) LIMIT 1
        ) c ON true
        JOIN LATERAL (
          SELECT id FROM cities ORDER BY slug OFFSET (g % 3) LIMIT 1
        ) ci ON true
        ON CONFLICT (slug) DO NOTHING`);

      console.log("Mirroring into the search read model (set-based)...");
      await db.execute(sql`
        INSERT INTO search_documents (
          entity_type, entity_id, slug, name_en, name_ar, name_ckb,
          category_key, city_slug, publicly_visible, rank
        )
        SELECT
          'facility', f.id, f.slug, f.name_en, f.name_ar, f.name_ckb,
          c.slug, ci.slug, f.publicly_visible, f.tier_rank
        FROM facilities f
        JOIN categories c ON c.id = f.category_id
        JOIN cities ci ON ci.id = f.city_id
        ON CONFLICT (entity_type, entity_id) DO NOTHING`);

      await db.execute(sql`ANALYZE facilities`);
      await db.execute(sql`ANALYZE search_documents`);
    }
    const total = await db.execute(sql`SELECT count(*)::int AS n FROM facilities`);
    console.log(`facilities: ${(total.rows[0] as { n: number }).n} rows`);

    await measure(app);
    await explain(app);
  } finally {
    await app.close();
    await tdb?.close();
  }
}

interface InjectResponse {
  statusCode: number;
  json(): unknown;
}

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

async function timedInject(
  app: FastifyInstance,
  url: string,
): Promise<{ ms: number; res: InjectResponse }> {
  const start = process.hrtime.bigint();
  const res = await app.inject({
    method: "GET",
    url,
    headers: { "x-mesomed-country": "IQ", "x-mesomed-locale": "en" },
  });
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  if (res.statusCode !== 200) {
    throw new Error(`${url} → ${res.statusCode}: ${res.body.slice(0, 300)}`);
  }
  return { ms, res };
}

function trpcUrl(procedure: string, input: unknown): string {
  return `/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`;
}

async function measure(app: FastifyInstance): Promise<void> {
  const categorySlugs = ["hospital", "dental_clinic", "beauty_center"];

  console.log(`\nMeasuring browse (keyset) — ${SAMPLES} requests walking real cursors...`);
  const browseSamples: number[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < SAMPLES; i++) {
    const input = {
      categorySlug: categorySlugs[i % 3]!,
      limit: 13,
      ...(cursor ? { cursor } : {}),
    };
    const { ms, res } = await timedInject(app, trpcUrl("directory.browseFacilities", input));
    if (i >= 10) browseSamples.push(ms); // discard warmup
    const body = (res.json() as { result: { data: { nextCursor: string | null } } }).result.data;
    // Walk deep into the keyset on one category, restart when exhausted.
    cursor = i % 3 === 0 ? (body.nextCursor ?? undefined) : cursor;
  }

  console.log(`Measuring trigram search — ${SAMPLES} requests with random md5 substrings...`);
  const searchSamples: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    // md5 hex substrings actually occur in the synthetic names.
    const fragment = Math.floor(Math.random() * 0xffff)
      .toString(16)
      .padStart(4, "0");
    const { ms } = await timedInject(
      app,
      trpcUrl("search.listings", { query: fragment, entityType: "facility", limit: 13 }),
    );
    if (i >= 10) searchSamples.push(ms);
  }

  const report = [
    ["browse (keyset via tRPC)", browseSamples],
    ["trigram search (via tRPC)", searchSamples],
  ] as const;
  console.log("\n================ Phase 3 perf gate ================");
  let pass = true;
  for (const [label, samples] of report) {
    const p50 = percentile(samples, 50).toFixed(1);
    const p95 = percentile(samples, 95);
    const p99 = percentile(samples, 99).toFixed(1);
    const ok = p95 < BUDGET_MS;
    pass &&= ok;
    console.log(
      `${label}: p50 ${p50}ms · p95 ${p95.toFixed(1)}ms · p99 ${p99}ms — ${ok ? "PASS" : "FAIL"} (budget p95 < ${BUDGET_MS}ms)`,
    );
  }
  if (!pass) {
    process.exitCode = 1;
    console.error("\nPerf gate FAILED");
  }
}

async function explain(app: FastifyInstance): Promise<void> {
  const { db } = app.kernel;
  console.log("\n================ EXPLAIN ANALYZE: landing keyset query ================");
  const mid = await db.execute(sql`
    SELECT f.tier_rank, f.name_en, f.id FROM facilities f
    WHERE f.publicly_visible = true
      AND f.category_id = (SELECT id FROM categories WHERE slug = 'hospital')
    ORDER BY f.tier_rank, f.name_en, f.id OFFSET 5000 LIMIT 1`);
  const row = mid.rows[0] as { tier_rank: number; name_en: string; id: string };
  const plan1 = await db.execute(sql`
    EXPLAIN ANALYZE
    SELECT id, slug, name_en, tier_rank FROM facilities
    WHERE publicly_visible = true
      AND category_id = (SELECT id FROM categories WHERE slug = 'hospital')
      AND (tier_rank, name_en, id) > (${row.tier_rank}, ${row.name_en}, ${sql.raw(`'${row.id}'::uuid`)})
    ORDER BY tier_rank, name_en, id
    LIMIT 13`);
  for (const line of plan1.rows) console.log((line as Record<string, string>)["QUERY PLAN"]);

  console.log("\n================ EXPLAIN ANALYZE: trigram search ================");
  const plan2 = await db.execute(sql`
    EXPLAIN ANALYZE
    SELECT entity_id, slug, name_en FROM search_documents
    WHERE publicly_visible = true AND entity_type = 'facility'
      AND (name_en ILIKE '%7f3a%' OR name_ar ILIKE '%7f3a%' OR name_ckb ILIKE '%7f3a%'
           OR search_vector @@ plainto_tsquery('simple', '7f3a'))
    ORDER BY rank, name_en, entity_id
    LIMIT 13`);
  for (const line of plan2.rows) console.log((line as Record<string, string>)["QUERY PLAN"]);
}

main().catch((error) => {
  console.error("perf-validation failed:", error);
  process.exitCode = 1;
});
