"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "../../../i18n/navigation";
import { authClient } from "../../../lib/auth-client";
import { trpc } from "../../../lib/trpc";

/**
 * Session landing: shows who is signed in and offers sign-out. The four
 * role dashboards (patient/doctor/secretary/admin) expand from here in the
 * dashboards slice — this page keeps the auth flows round-trippable.
 */
export default function DashboardPage() {
  const t = useTranslations("web.auth");
  const router = useRouter();
  const me = trpc.identity.me.useQuery(undefined, { retry: false });

  if (me.isLoading) {
    return (
      <main className="mx-auto w-full max-w-2xl animate-pulse px-4 py-14">
        <div className="h-8 w-1/2 rounded-sm bg-neutral-100" />
        <div className="mt-4 h-24 rounded-lg bg-neutral-100" />
      </main>
    );
  }

  if (me.error || !me.data) {
    router.replace("/auth/sign-in");
    return null;
  }

  const user = me.data;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-14">
      <h1 className="text-title font-bold text-ink">
        {user.patientProfile?.fullName ?? user.email ?? user.phone}
      </h1>
      <dl className="mt-6 flex flex-col gap-2 rounded-lg border border-line bg-surface p-5 text-body">
        <div className="flex flex-wrap gap-2">
          {user.roles.map((role) => (
            <span
              key={role}
              className="rounded-sm bg-brand-soft px-2 py-0.5 text-caption font-semibold text-brand"
            >
              {role}
            </span>
          ))}
        </div>
        {user.phone && (
          <dd className="text-neutral-600" dir="ltr">
            {user.phone}
          </dd>
        )}
        {user.email && (
          <dd className="text-neutral-600" dir="ltr">
            {user.email}
          </dd>
        )}
      </dl>
      <button
        type="button"
        onClick={() => {
          void authClient.signOut().then(() => router.push("/"));
        }}
        className="mt-6 rounded-md border border-line px-5 py-2 text-small font-medium text-neutral-600 transition-colors duration-fast hover:border-danger hover:text-danger"
      >
        {t("signOut")}
      </button>
    </main>
  );
}
