import type { ReactNode } from "react";
import DashboardShell from "./shell";

/**
 * Dashboard routes MUST render dynamically: the CSP for session-scoped
 * paths is nonce-mode with `strict-dynamic` (proxy.ts), and only a
 * dynamically rendered document can carry the per-request nonce on its
 * script tags. Statically prerendered dashboard HTML ships un-nonced
 * scripts that the CSP rightly blocks — the page never hydrates (caught
 * by the Phase 8 e2e suite against the production build).
 */
export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
