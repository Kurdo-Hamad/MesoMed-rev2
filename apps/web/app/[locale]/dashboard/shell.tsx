"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { Link, useRouter } from "../../../i18n/navigation";
import { trpc } from "../../../lib/trpc";

/**
 * Dashboard shell (Phase 8 dashboards): role-aware navigation over the
 * session's roles from identity.me. Pages themselves re-check roles — the
 * nav is convenience, the API layer is the authority (§3.6).
 */
export default function DashboardShell({ children }: { children: ReactNode }) {
  const t = useTranslations("web.dashboard");
  const router = useRouter();
  const pathname = usePathname();
  const me = trpc.identity.me.useQuery(undefined, { retry: false });

  if (me.isLoading) {
    return (
      <main className="mx-auto w-full max-w-5xl animate-pulse px-4 py-10">
        <div className="h-8 w-1/3 rounded-sm bg-neutral-100" />
        <div className="mt-6 h-40 rounded-lg bg-neutral-100" />
      </main>
    );
  }

  if (me.error || !me.data) {
    router.replace("/auth/sign-in");
    return null;
  }

  const roles = me.data.roles;
  const tabs: Array<{ href: string; label: string }> = [
    { href: "/dashboard", label: t("navOverview") },
    ...(roles.includes("patient")
      ? [
          { href: "/dashboard/appointments", label: t("navAppointments") },
          { href: "/dashboard/health", label: t("navHealth") },
        ]
      : []),
    ...(roles.includes("doctor") || roles.includes("secretary")
      ? [{ href: "/dashboard/clinic", label: t("navClinic") }]
      : []),
    ...(roles.includes("doctor")
      ? [{ href: "/dashboard/encounters", label: t("navEncounters") }]
      : []),
    ...(roles.includes("admin") ? [{ href: "/dashboard/admin", label: t("navAdmin") }] : []),
  ];

  // pathname includes the locale prefix; match on the suffix.
  const isActive = (href: string) =>
    href === "/dashboard" ? /\/dashboard\/?$/.test(pathname) : pathname.includes(href);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <nav aria-label={t("navLabel")} className="flex flex-wrap gap-1 border-b border-line pb-px">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={
              isActive(tab.href)
                ? "rounded-t-md border-b-2 border-brand px-4 py-2 text-small font-semibold text-brand"
                : "rounded-t-md px-4 py-2 text-small font-medium text-neutral-600 transition-colors duration-fast hover:text-ink"
            }
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
