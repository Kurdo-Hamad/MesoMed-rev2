"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@mesomed/i18n";
import { FilterSelect } from "../../../../components/filter-select";
import { pickText } from "../../../../lib/localized";
import { trpc } from "../../../../lib/trpc";

const field =
  "h-11 w-full rounded-md border border-line bg-canvas px-3 text-body text-ink shadow-card outline-none transition-shadow duration-fast placeholder:text-neutral-400 focus:border-brand";

type Section = "providers" | "billing" | "support" | "taxonomy";

/**
 * Admin suite (Phase 8 dashboards): provider verification queue, facility
 * tier payments, time-boxed clinical support grants, and taxonomy gating.
 * Every mutation is admin-gated at the kernel; this page is navigation.
 */
export default function AdminPage() {
  const t = useTranslations("web.dashboard");
  const [section, setSection] = useState<Section>("providers");

  const sections: Array<{ key: Section; label: string }> = [
    { key: "providers", label: t("adminProviders") },
    { key: "billing", label: t("adminBilling") },
    { key: "support", label: t("adminSupport") },
    { key: "taxonomy", label: t("adminTaxonomy") },
  ];

  return (
    <main className="py-8">
      <h1 className="text-title font-bold text-ink">{t("adminTitle")}</h1>

      <div className="mt-4 flex flex-wrap gap-2">
        {sections.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setSection(entry.key)}
            className={
              section === entry.key
                ? "rounded-md bg-brand px-4 py-2 text-small font-semibold text-white"
                : "rounded-md border border-line px-4 py-2 text-small font-medium text-neutral-600 transition-colors duration-fast hover:border-brand hover:text-ink"
            }
          >
            {entry.label}
          </button>
        ))}
      </div>

      {section === "providers" && <ProviderQueue />}
      {section === "billing" && <TierPayments />}
      {section === "support" && <SupportGrants />}
      {section === "taxonomy" && <TaxonomyGating />}
    </main>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <section className="mt-6 rounded-lg border border-line bg-surface p-5">{children}</section>
  );
}

function ProviderQueue() {
  const t = useTranslations("web.dashboard");
  const locale = useLocale() as Locale;
  const utils = trpc.useUtils();
  const pending = trpc.identity.listPendingProviders.useQuery();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const setStatus = trpc.identity.setProviderStatus.useMutation({
    onSuccess: () => {
      setRejectingId(null);
      setReason("");
      void utils.identity.listPendingProviders.invalidate();
    },
  });

  const dateLabel = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <Card>
      <h2 className="text-heading font-bold text-ink">{t("providerQueue")}</h2>
      {pending.isLoading ? (
        <div className="mt-3 h-20 animate-pulse rounded-md bg-neutral-100" />
      ) : (pending.data?.length ?? 0) === 0 ? (
        <p className="mt-3 text-small text-neutral-500">{t("noPendingProviders")}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {pending.data!.map((provider) => (
            <li
              key={provider.providerProfileId}
              className="rounded-md border border-line bg-canvas px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-body font-medium text-ink">
                    {t(`providerType_${provider.providerType}`)}
                    <span className="ms-2 text-small text-neutral-500" dir="ltr">
                      {provider.email ?? provider.phone}
                    </span>
                  </p>
                  <p className="text-caption text-neutral-400">
                    {dateLabel.format(new Date(provider.createdAt))}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={setStatus.isPending}
                    onClick={() =>
                      setStatus.mutate({
                        providerProfileId: provider.providerProfileId,
                        status: "approved",
                      })
                    }
                    className="rounded-md bg-brand px-4 py-1.5 text-small font-semibold text-white transition-colors duration-fast hover:bg-brand-strong disabled:opacity-50"
                  >
                    {t("approve")}
                  </button>
                  <button
                    type="button"
                    disabled={setStatus.isPending}
                    onClick={() => setRejectingId(provider.providerProfileId)}
                    className="rounded-md border border-line px-4 py-1.5 text-small font-medium text-neutral-600 transition-colors duration-fast hover:border-danger hover:text-danger disabled:opacity-50"
                  >
                    {t("reject")}
                  </button>
                </div>
              </div>
              {rejectingId === provider.providerProfileId && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    setStatus.mutate({
                      providerProfileId: provider.providerProfileId,
                      status: "rejected",
                      ...(reason.trim() ? { reason: reason.trim() } : {}),
                    });
                  }}
                  className="mt-3 flex flex-wrap items-center gap-2"
                >
                  <input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder={t("rejectReason")}
                    className={`${field} max-w-md flex-1`}
                  />
                  <button
                    type="submit"
                    disabled={setStatus.isPending}
                    className="rounded-md bg-danger px-4 py-2 text-small font-semibold text-white disabled:opacity-50"
                  >
                    {t("confirmReject")}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {setStatus.error && (
        <p className="mt-3 rounded-md bg-danger-soft px-4 py-2 text-small font-medium text-danger">
          {t("actionFailed")}
        </p>
      )}
    </Card>
  );
}

function TierPayments() {
  const t = useTranslations("web.dashboard");
  const locale = useLocale() as Locale;
  const utils = trpc.useUtils();

  const categories = trpc.directory.listCategories.useQuery();
  const [categorySlug, setCategorySlug] = useState<string | undefined>(undefined);
  const selectedCategory = categorySlug ?? categories.data?.categories[0]?.slug;

  const facilities = trpc.directory.browseFacilities.useQuery(
    { categorySlug: selectedCategory ?? "", limit: 50 },
    { enabled: Boolean(selectedCategory) },
  );
  const [facilityId, setFacilityId] = useState<string | undefined>(undefined);
  const selectedFacility = facilityId ?? facilities.data?.items[0]?.id;

  const tiers = trpc.billing.listTiers.useQuery();
  const tierState = trpc.billing.facilityTierState.useQuery(
    { facilityId: selectedFacility ?? "" },
    { enabled: Boolean(selectedFacility) },
  );

  const [tierKey, setTierKey] = useState("");
  const [periods, setPeriods] = useState(1);

  const record = trpc.billing.recordTierPayment.useMutation({
    onSuccess: () => void utils.billing.facilityTierState.invalidate(),
  });

  const dateLabel = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedFacility || !tierKey) return;
    record.mutate({
      idempotencyKey: crypto.randomUUID(),
      facilityId: selectedFacility,
      tierKey,
      periods,
    });
  }

  return (
    <Card>
      <h2 className="text-heading font-bold text-ink">{t("tierPayments")}</h2>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FilterSelect
          label={t("category")}
          value={selectedCategory ?? ""}
          onChange={(value) => {
            setCategorySlug(value);
            setFacilityId(undefined);
          }}
        >
          {(categories.data?.categories ?? []).map((category) => (
            <option key={category.slug} value={category.slug}>
              {pickText(category.name, locale)}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label={t("facility")} value={selectedFacility ?? ""} onChange={setFacilityId}>
          {(facilities.data?.items ?? []).map((facility) => (
            <option key={facility.id} value={facility.id}>
              {pickText(facility.name, locale)}
            </option>
          ))}
        </FilterSelect>
      </div>

      {tierState.data && (
        <div className="mt-4 rounded-md border border-line bg-canvas px-4 py-3">
          <p className="text-body text-neutral-700">
            {t("currentTier")}:{" "}
            <span className="font-semibold text-ink">{tierState.data.tierKey ?? t("none")}</span>
            {tierState.data.tierExpiresAt && (
              <span className="ms-2 text-small text-neutral-500">
                {t("tierExpires", {
                  date: dateLabel.format(new Date(tierState.data.tierExpiresAt)),
                })}
              </span>
            )}
          </p>
          {tierState.data.payments.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {tierState.data.payments.slice(0, 5).map((payment) => (
                <li key={payment.tierPaymentId} className="text-caption text-neutral-500">
                  {payment.tierKey} · {dateLabel.format(new Date(payment.periodStart))} →{" "}
                  {dateLabel.format(new Date(payment.periodEnd))} ·{" "}
                  <span dir="ltr">
                    {payment.amount} {payment.currency}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
          {t("tier")}
          <select
            required
            value={tierKey}
            onChange={(event) => setTierKey(event.target.value)}
            className={field}
          >
            <option value="">—</option>
            {(tiers.data?.tiers ?? []).map((tier) => (
              <option key={tier.key} value={tier.key}>
                {pickText(tier.name, locale)}
                {tier.price ? ` (${tier.price.amount} ${tier.price.currency})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
          {t("periods")}
          <input
            type="number"
            min={1}
            max={12}
            value={periods}
            onChange={(event) => setPeriods(Number(event.target.value))}
            className={`${field} w-24`}
          />
        </label>
        <button
          type="submit"
          disabled={record.isPending || !tierKey}
          className="h-11 rounded-md bg-brand px-6 text-small font-semibold text-white transition-colors duration-fast hover:bg-brand-strong disabled:opacity-50"
        >
          {t("recordPayment")}
        </button>
      </form>

      {record.data && (
        <p
          className={`mt-3 rounded-md px-4 py-2 text-small font-medium ${
            record.data.applied ? "bg-success-soft text-success" : "bg-warning-soft text-warning"
          }`}
        >
          {record.data.applied ? t("paymentRecorded") : t("paymentDuplicate")}
        </p>
      )}
      {record.error && (
        <p className="mt-3 rounded-md bg-danger-soft px-4 py-2 text-small font-medium text-danger">
          {t("actionFailed")}
        </p>
      )}
    </Card>
  );
}

function SupportGrants() {
  const t = useTranslations("web.dashboard");
  const locale = useLocale() as Locale;
  const utils = trpc.useUtils();
  const grants = trpc.clinical.listSupportGrants.useQuery({});

  const [encounterId, setEncounterId] = useState("");
  const [reason, setReason] = useState("");
  const [hours, setHours] = useState(4);

  const grant = trpc.clinical.grantSupportAccess.useMutation({
    onSuccess: () => {
      setEncounterId("");
      setReason("");
      void utils.clinical.listSupportGrants.invalidate();
    },
  });
  const revoke = trpc.clinical.revokeSupportAccess.useMutation({
    onSuccess: () => void utils.clinical.listSupportGrants.invalidate(),
  });

  const stamp = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  function submit(event: FormEvent) {
    event.preventDefault();
    grant.mutate({
      encounterId: encounterId.trim(),
      reason: reason.trim(),
      expiresAt: new Date(Date.now() + hours * 3_600_000).toISOString(),
    });
  }

  return (
    <Card>
      <h2 className="text-heading font-bold text-ink">{t("supportGrants")}</h2>
      <p className="mt-1 text-caption text-neutral-500">{t("supportGrantsHint")}</p>

      <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
          {t("encounterId")}
          <input
            required
            dir="ltr"
            value={encounterId}
            onChange={(event) => setEncounterId(event.target.value)}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
          {t("grantReason")}
          <input
            required
            minLength={5}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
          {t("grantHours")}
          <input
            type="number"
            min={1}
            max={72}
            value={hours}
            onChange={(event) => setHours(Number(event.target.value))}
            className={field}
          />
        </label>
        {grant.error && (
          <p className="rounded-md bg-danger-soft px-4 py-2 text-small font-medium text-danger sm:col-span-3">
            {t("actionFailed")}
          </p>
        )}
        <div className="sm:col-span-3">
          <button
            type="submit"
            disabled={grant.isPending}
            className="rounded-md bg-brand px-6 py-2 text-small font-semibold text-white transition-colors duration-fast hover:bg-brand-strong disabled:opacity-50"
          >
            {t("grantAccess")}
          </button>
        </div>
      </form>

      {grants.isLoading ? (
        <div className="mt-4 h-16 animate-pulse rounded-md bg-neutral-100" />
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {(grants.data?.grants ?? []).map((entry) => {
            const active = !entry.revokedAt && new Date(entry.expiresAt) > new Date();
            return (
              <li
                key={entry.grantId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-canvas px-4 py-3"
              >
                <div>
                  <p className="text-small font-medium text-ink" dir="ltr">
                    {entry.encounterId}
                  </p>
                  <p className="text-caption text-neutral-500">
                    {entry.reason} ·{" "}
                    {t("grantExpires", { date: stamp.format(new Date(entry.expiresAt)) })}
                  </p>
                </div>
                {active ? (
                  <button
                    type="button"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate({ grantId: entry.grantId })}
                    className="rounded-md border border-line px-4 py-1.5 text-small font-medium text-neutral-600 transition-colors duration-fast hover:border-danger hover:text-danger disabled:opacity-50"
                  >
                    {t("revoke")}
                  </button>
                ) : (
                  <span className="rounded-sm bg-neutral-100 px-2 py-0.5 text-caption font-semibold text-neutral-500">
                    {entry.revokedAt ? t("revoked") : t("expired")}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function TaxonomyGating() {
  const t = useTranslations("web.dashboard");
  const locale = useLocale() as Locale;
  const utils = trpc.useUtils();
  const specialties = trpc.directory.listSpecialties.useQuery();

  const setFeatured = trpc.directory.setSpecialtyFeatured.useMutation({
    onSettled: () => void utils.directory.listSpecialties.invalidate(),
  });

  return (
    <Card>
      <h2 className="text-heading font-bold text-ink">{t("specialtyFeaturing")}</h2>
      <p className="mt-1 text-caption text-neutral-500">{t("specialtyFeaturingHint")}</p>

      {specialties.isLoading ? (
        <div className="mt-4 h-24 animate-pulse rounded-md bg-neutral-100" />
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(specialties.data?.specialties ?? []).map((specialty) => (
            <li
              key={specialty.key}
              className="flex items-center justify-between gap-3 rounded-md border border-line bg-canvas px-4 py-2.5"
            >
              <span className="text-body text-ink">{pickText(specialty.name, locale)}</span>
              <button
                type="button"
                disabled={setFeatured.isPending}
                onClick={() =>
                  setFeatured.mutate({ key: specialty.key, featured: !specialty.featured })
                }
                className={
                  specialty.featured
                    ? "rounded-md bg-brand px-3 py-1 text-caption font-semibold text-white"
                    : "rounded-md border border-line px-3 py-1 text-caption font-medium text-neutral-500 transition-colors duration-fast hover:border-brand hover:text-ink"
                }
              >
                {specialty.featured ? t("featured") : t("feature")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {setFeatured.error && (
        <p className="mt-3 rounded-md bg-danger-soft px-4 py-2 text-small font-medium text-danger">
          {t("actionFailed")}
        </p>
      )}
    </Card>
  );
}
