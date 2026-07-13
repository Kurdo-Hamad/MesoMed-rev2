import { useSyncExternalStore } from "react";
import { TRPCClientError } from "@trpc/client";

/**
 * Whether the app must show the country-coming-soon screen (kernel's
 * assertCountryActive, MM-PLAN-001 §3.9) — same external-store shape as
 * lib/upgrade-required.ts, so any query/mutation error can flip it from
 * outside the component tree via the query client's global error handler.
 */
let countryComingSoon = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function setCountryComingSoon(value: boolean): void {
  if (countryComingSoon === value) return;
  countryComingSoon = value;
  emit();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): boolean {
  return countryComingSoon;
}

export function useCountryComingSoon(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** apps/api/src/kernel/gating.ts throws ErrorCode.COUNTRY_COMING_SOON,
 * carried to the client as `error.data.appCode` (same errorFormatter as
 * UPGRADE_REQUIRED). */
export function isCountryComingSoonError(error: unknown): boolean {
  if (!(error instanceof TRPCClientError)) return false;
  const appCode = (error.data as { appCode?: string } | null | undefined)?.appCode;
  return appCode === "COUNTRY_COMING_SOON";
}
