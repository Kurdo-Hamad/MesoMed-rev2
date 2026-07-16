/**
 * Shared helpers for the Phase 10 k6 suite (MM-DES-003 §6, ADR-0030).
 * tRPC HTTP encoding matches apps/api/test/booking/helpers.ts: queries are
 * GET /trpc/<proc>?input=<url-encoded JSON>, mutations are POST with the
 * raw input JSON (no transformer).
 */
import http from "k6/http";

export const BASE = __ENV.BASE_URL;

export function trpcQuery(proc, input, params = {}) {
  const query = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  return http.get(`${BASE}/trpc/${proc}${query}`, params);
}

export function trpcMutation(proc, input, params = {}) {
  return http.post(`${BASE}/trpc/${proc}`, JSON.stringify(input ?? {}), {
    ...params,
    headers: { "content-type": "application/json", ...(params.headers ?? {}) },
  });
}

/** Parse a tRPC success payload; returns undefined on error responses. */
export function trpcData(res) {
  try {
    const body = JSON.parse(res.body);
    return body?.result?.data;
  } catch {
    return undefined;
  }
}

/** The typed tRPC error code of a non-2xx response, or undefined. */
export function trpcErrorCode(res) {
  try {
    const body = JSON.parse(res.body);
    return body?.error?.data?.appCode ?? body?.error?.message;
  } catch {
    return undefined;
  }
}

export function loadData() {
  return JSON.parse(__ENV.K6_DATA);
}

/** Unique, valid-shape Iraqi mobile per VU+iteration (+96479 block — the
 * seeder uses +96475, tests use +96477, so collisions are impossible). */
export function uniquePhone(vu, iter) {
  return `+96479${String((vu % 1000) * 100000 + (iter % 100000)).padStart(8, "0")}`;
}
