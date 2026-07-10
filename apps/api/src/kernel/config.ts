import type { z } from "zod";
import { eq } from "drizzle-orm";
import { configEntries, type Db } from "@mesomed/db";
import { ErrorCode } from "@mesomed/contracts/errors";
import { AppError } from "./errors.js";

/**
 * Config-over-code service (MM-PLAN-001 §3.9): configuration lives in
 * `config_entries` rows, every read is validated against the caller's Zod
 * schema, and reads are cached in-process with a TTL plus explicit
 * invalidation (writes through this service invalidate their own key).
 * Domain config schemas (countries, categories, tiers …) arrive with their
 * consumers from Phase 3 in `packages/config`.
 */
export interface ConfigService {
  /** Read and validate a config value; AppError(NOT_FOUND) if the key is absent. */
  get<Schema extends z.ZodType>(schema: Schema, key: string): Promise<z.output<Schema>>;
  /** Validate and upsert a config value, invalidating the cache for the key. */
  set<Schema extends z.ZodType>(schema: Schema, key: string, value: z.input<Schema>): Promise<void>;
  /** Drop one key from the cache, or everything when no key is given. */
  invalidate(key?: string): void;
}

const DEFAULT_TTL_MS = 30_000;

export function createConfigService(db: Db, options?: { ttlMs?: number }): ConfigService {
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const cache = new Map<string, { value: unknown; expiresAt: number }>();

  return {
    async get(schema, key) {
      const cached = cache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        return schema.parse(cached.value);
      }
      const [row] = await db
        .select({ value: configEntries.value })
        .from(configEntries)
        .where(eq(configEntries.key, key))
        .limit(1);
      if (!row) {
        throw new AppError(ErrorCode.NOT_FOUND, `No config entry for key "${key}"`);
      }
      cache.set(key, { value: row.value, expiresAt: Date.now() + ttlMs });
      return schema.parse(row.value);
    },

    async set(schema, key, value) {
      const parsed = schema.parse(value);
      await db
        .insert(configEntries)
        .values({ key, value: parsed, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: configEntries.key,
          set: { value: parsed, updatedAt: new Date() },
        });
      cache.delete(key);
    },

    invalidate(key) {
      if (key === undefined) cache.clear();
      else cache.delete(key);
    },
  };
}
