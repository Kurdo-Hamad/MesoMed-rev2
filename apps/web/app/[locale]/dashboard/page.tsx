"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "../../../i18n/navigation";
import { authClient } from "../../../lib/auth-client";
import { trpc } from "../../../lib/trpc";

/**
 * Dashboard overview: who is signed in, provider verification state
 * (MM-DEC §3 pending-review is visible, never silent), and sign-out.
 * Role-specific work lives in the sibling tabs.
 */
export default function DashboardOverviewPage() {
  const t = useTranslations("web.dashboard");
  const tAuth = useTranslations("web.auth");
  const router = useRouter();
  const me = trpc.identity.me.useQuery(undefined, { retry: false });

  if (!me.data) return null;
  const user = me.data;
  // identity.me already carries the provider profile with status — a
  // pending provider has no doctor role yet, so this is the only source.
  const status = user.providerProfile?.status;

  return (
    <main className="py-8">
      <h1 className="text-title font-bold text-ink">
        {user.patientProfile?.fullName ?? user.email ?? user.phone}
      </h1>

      {status && status !== "approved" && (
        <p
          className={`mt-4 rounded-md px-4 py-3 text-small font-medium ${
            status === "rejected" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"
          }`}
        >
          {status === "rejected"
            ? t("providerRejected", { reason: user.providerProfile?.rejectionReason ?? "—" })
            : t("providerPending")}
        </p>
      )}

      <dl className="mt-6 flex flex-col gap-2 rounded-lg border border-line bg-surface p-5 text-body">
        <div className="flex flex-wrap gap-2">
          {user.roles.map((role) => (
            <span
              key={role}
              className="rounded-sm bg-brand-soft px-2 py-0.5 text-caption font-semibold text-brand"
            >
              {t(`role_${role}`)}
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
        {tAuth("signOut")}
      </button>
    </main>
  );
}
