import { useSyncExternalStore } from "react";
import { TRPCClientError } from "@trpc/client";

/**
 * Whether the app must show the blocking upgrade screen (ADR-0013): a tiny
 * external store, not React context, so it can be set from the
 * TanStack Query cache's global error handler (outside any component).
 */
let upgradeRequired = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function setUpgradeRequired(value: boolean): void {
  if (upgradeRequired === value) return;
  upgradeRequired = value;
  emit();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): boolean {
  return upgradeRequired;
}

export function useUpgradeRequired(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** The kernel's app-version gate (apps/api/src/kernel/app-version.ts) throws
 * ErrorCode.UPGRADE_REQUIRED, carried to the client as `error.data.appCode`
 * (the tRPC errorFormatter in apps/api/src/kernel/trpc.ts). */
export function isUpgradeRequiredError(error: unknown): boolean {
  if (!(error instanceof TRPCClientError)) return false;
  const appCode = (error.data as { appCode?: string } | null | undefined)?.appCode;
  return appCode === "UPGRADE_REQUIRED";
}
