import type { FastifyInstance } from "fastify";
import type { Role } from "@mesomed/contracts/roles";
import { buildServer } from "../../src/app.js";
import { testEnv } from "../helpers.js";

/**
 * Directory test app: the real composition root with the header-injected
 * session resolver the Phase 1/2 authz suites established (real-session
 * integration is proven in the identity suites).
 */
export function buildDirectoryTestServer(connectionString: string): Promise<FastifyInstance> {
  return buildServer(testEnv(connectionString), {
    sessionResolver: (req) => {
      const header = req.headers["x-test-roles"];
      const value = Array.isArray(header) ? header[0] : header;
      if (value === undefined) return null;
      return {
        userId: "user-under-test",
        roles: value === "" ? [] : (value.split(",") as Role[]),
      };
    },
  });
}

export interface CallOptions {
  roles?: string;
  country?: string;
  locale?: string;
}

/** Invoke a tRPC procedure through the real HTTP surface. */
export async function trpc(
  app: FastifyInstance,
  procedure: string,
  kind: "query" | "mutation",
  input?: unknown,
  options: CallOptions = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.roles !== undefined) headers["x-test-roles"] = options.roles;
  if (options.country !== undefined) headers["x-mesomed-country"] = options.country;
  if (options.locale !== undefined) headers["x-mesomed-locale"] = options.locale;

  if (kind === "query") {
    const query = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
    return app.inject({ method: "GET", url: `/trpc/${procedure}${query}`, headers });
  }
  return app.inject({
    method: "POST",
    url: `/trpc/${procedure}`,
    headers,
    payload: input === undefined ? {} : JSON.stringify(input),
  });
}

/** Unwrap a successful tRPC response body. */
export function result<T>(res: { json(): unknown }): T {
  return (res.json() as { result: { data: T } }).result.data;
}

export const ADMIN = { roles: "admin" } satisfies CallOptions;

/** Minimal live-country fixture: iraq active, city + category + specialty. */
export async function seedBaseFixture(app: FastifyInstance): Promise<void> {
  const calls: Array<[string, unknown]> = [
    [
      "directory.upsertCountry",
      { slug: "iraq", isoCode: "IQ", name: { en: "Iraq", ar: "العراق", ckb: "عێراق" } },
    ],
    ["directory.setCountryGating", { isoCode: "IQ", status: "active" }],
    [
      "directory.upsertCity",
      {
        slug: "erbil",
        countrySlug: "iraq",
        name: { en: "Erbil", ar: "أربيل", ckb: "هەولێر" },
      },
    ],
    [
      "directory.upsertCategory",
      {
        slug: "hospital",
        name: { en: "Hospitals", ar: "المستشفيات", ckb: "نەخۆشخانەکان" },
        iconKey: "building-2",
      },
    ],
    [
      "directory.upsertSectionType",
      {
        key: "department",
        label: { en: "Departments", ar: "الأقسام", ckb: "بەشەکان" },
      },
    ],
    [
      "directory.setCategorySectionTypes",
      { categorySlug: "hospital", sectionTypeKeys: ["department"] },
    ],
    [
      "directory.upsertSpecialty",
      {
        key: "cardiology",
        name: { en: "Cardiology", ar: "أمراض القلب", ckb: "نەخۆشیەکانی دڵ" },
      },
    ],
  ];
  for (const [procedure, input] of calls) {
    const res = await trpc(app, procedure, "mutation", input, ADMIN);
    if (res.statusCode !== 200) {
      throw new Error(`${procedure} failed in fixture: ${res.statusCode} ${res.body}`);
    }
  }
}
