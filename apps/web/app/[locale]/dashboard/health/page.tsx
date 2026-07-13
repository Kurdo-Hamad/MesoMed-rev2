"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatLocalizedDate, type Locale } from "@mesomed/i18n";
import { BLOOD_TYPES, MEDICATION_SOURCES } from "@mesomed/contracts/clinical";
import { trpc } from "../../../../lib/trpc";

const field =
  "h-11 w-full rounded-md border border-line bg-canvas px-3 text-body text-ink shadow-card outline-none transition-shadow duration-fast placeholder:text-neutral-400 focus:border-brand";

/**
 * Patient health record (ADR-0010 self-view): prescriptions issued to the
 * patient (read-only revision chains), the patient-authored medical
 * profile, and patient-reported medications — kept structurally separate
 * from prescriptions, never merged. Visit notes are deliberately absent.
 */
export default function PatientHealthPage() {
  const t = useTranslations("web.dashboard");
  const record = trpc.clinical.myClinicalRecord.useQuery();

  if (record.isLoading) {
    return (
      <main className="animate-pulse py-8">
        <div className="h-40 rounded-lg bg-neutral-100" />
        <div className="mt-4 h-40 rounded-lg bg-neutral-100" />
      </main>
    );
  }

  if (!record.data) {
    return (
      <main className="py-8">
        <p className="rounded-md bg-surface px-4 py-3 text-body text-neutral-500">
          {t("healthEmpty")}
        </p>
      </main>
    );
  }

  return (
    <main className="py-8">
      <h1 className="text-title font-bold text-ink">{t("healthTitle")}</h1>
      <MedicalProfileCard profile={record.data.medicalProfile} />
      <ReportedMedications medications={record.data.reportedMedications} />
      <Prescriptions chains={record.data.prescriptionChains} />
    </main>
  );
}

function MedicalProfileCard({
  profile,
}: {
  profile: {
    bloodType: string;
    allergies: string[];
    notes: string | null;
  } | null;
}) {
  const t = useTranslations("web.dashboard");
  const locale = useLocale() as Locale;
  const listFormat = new Intl.ListFormat(locale, { style: "narrow" });
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [bloodType, setBloodType] = useState(profile?.bloodType ?? "unknown");
  const [allergies, setAllergies] = useState((profile?.allergies ?? []).join(", "));
  const [notes, setNotes] = useState(profile?.notes ?? "");

  const upsert = trpc.clinical.upsertMedicalProfile.useMutation({
    onSuccess: () => {
      setEditing(false);
      void utils.clinical.myClinicalRecord.invalidate();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const list = allergies
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    upsert.mutate({
      bloodType: bloodType as (typeof BLOOD_TYPES)[number],
      allergies: list,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
  }

  return (
    <section className="mt-6 rounded-lg border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-heading font-bold text-ink">{t("medicalProfile")}</h2>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-line px-4 py-1.5 text-small font-medium text-neutral-600 transition-colors duration-fast hover:border-brand hover:text-ink"
          >
            {profile ? t("edit") : t("addProfile")}
          </button>
        )}
      </div>

      {editing ? (
        <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
            {t("bloodType")}
            <select
              value={bloodType}
              onChange={(event) => setBloodType(event.target.value)}
              className={field}
            >
              {BLOOD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type === "unknown" ? t("bloodTypeUnknown") : type}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
            {t("allergies")}
            <input
              value={allergies}
              onChange={(event) => setAllergies(event.target.value)}
              placeholder={t("allergiesHint")}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1 text-small font-medium text-neutral-600 sm:col-span-2">
            {t("profileNotes")}
            <textarea
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-body text-ink shadow-card outline-none focus:border-brand"
            />
          </label>
          {upsert.error && (
            <p className="rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger sm:col-span-2">
              {t("saveFailed")}
            </p>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={upsert.isPending}
              className="rounded-md bg-brand px-6 py-2 text-small font-semibold text-white transition-colors duration-fast hover:bg-brand-strong disabled:opacity-50"
            >
              {t("save")}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md px-4 py-2 text-small font-medium text-neutral-500 hover:text-ink"
            >
              {t("cancelEdit")}
            </button>
          </div>
        </form>
      ) : profile ? (
        <dl className="mt-3 flex flex-col gap-1 text-body text-neutral-700">
          <div>
            <dt className="inline font-medium">{t("bloodType")}: </dt>
            <dd className="inline">
              {profile.bloodType === "unknown" ? t("bloodTypeUnknown") : profile.bloodType}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">{t("allergies")}: </dt>
            <dd className="inline">
              {profile.allergies.length > 0 ? listFormat.format(profile.allergies) : t("none")}
            </dd>
          </div>
          {profile.notes && <p className="text-small text-neutral-500">{profile.notes}</p>}
        </dl>
      ) : (
        <p className="mt-3 text-small text-neutral-500">{t("noProfile")}</p>
      )}
    </section>
  );
}

function ReportedMedications({
  medications,
}: {
  medications: Array<{
    reportedMedicationId: string;
    medicationName: string;
    dosage: string | null;
    source: string;
  }>;
}) {
  const t = useTranslations("web.dashboard");
  const utils = trpc.useUtils();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [dosage, setDosage] = useState("");
  const [source, setSource] = useState<(typeof MEDICATION_SOURCES)[number]>("over_the_counter");

  const add = trpc.clinical.addReportedMedication.useMutation({
    onSuccess: () => {
      setAdding(false);
      setName("");
      setDosage("");
      void utils.clinical.myClinicalRecord.invalidate();
    },
  });
  const remove = trpc.clinical.removeReportedMedication.useMutation({
    onSuccess: () => void utils.clinical.myClinicalRecord.invalidate(),
  });

  return (
    <section className="mt-6 rounded-lg border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-heading font-bold text-ink">{t("reportedMedications")}</h2>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md border border-line px-4 py-1.5 text-small font-medium text-neutral-600 transition-colors duration-fast hover:border-brand hover:text-ink"
          >
            {t("addMedication")}
          </button>
        )}
      </div>
      <p className="mt-1 text-caption text-neutral-500">{t("reportedMedicationsHint")}</p>

      {adding && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate({
              medicationName: name.trim(),
              source,
              ...(dosage.trim() ? { dosage: dosage.trim() } : {}),
            });
          }}
          className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3"
        >
          <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
            {t("medicationName")}
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
            {t("dosage")}
            <input
              value={dosage}
              onChange={(event) => setDosage(event.target.value)}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
            {t("medicationSource")}
            <select
              value={source}
              onChange={(event) => setSource(event.target.value as typeof source)}
              className={field}
            >
              {MEDICATION_SOURCES.map((value) => (
                <option key={value} value={value}>
                  {t(`source_${value}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2 sm:col-span-3">
            <button
              type="submit"
              disabled={add.isPending}
              className="rounded-md bg-brand px-6 py-2 text-small font-semibold text-white transition-colors duration-fast hover:bg-brand-strong disabled:opacity-50"
            >
              {t("save")}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-md px-4 py-2 text-small font-medium text-neutral-500 hover:text-ink"
            >
              {t("cancelEdit")}
            </button>
          </div>
        </form>
      )}

      {medications.length === 0 ? (
        <p className="mt-3 text-small text-neutral-500">{t("none")}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {medications.map((medication) => (
            <li
              key={medication.reportedMedicationId}
              className="flex items-center justify-between gap-3 rounded-md border border-line bg-canvas px-4 py-2.5"
            >
              <div>
                <p className="text-body font-medium text-ink">{medication.medicationName}</p>
                <p className="text-caption text-neutral-500">
                  {medication.dosage ? `${medication.dosage} · ` : ""}
                  {t(`source_${medication.source}`)}
                </p>
              </div>
              <button
                type="button"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate({ reportedMedicationId: medication.reportedMedicationId })
                }
                className="text-small font-medium text-neutral-500 transition-colors duration-fast hover:text-danger disabled:opacity-50"
              >
                {t("remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Prescriptions({
  chains,
}: {
  chains: Array<{
    revisions: Array<{
      prescriptionId: string;
      medicationName: string;
      dosage: string;
      frequency: string;
      duration: string;
      instructions: string | null;
      status: string;
      issuedAt: string;
    }>;
  }>;
}) {
  const t = useTranslations("web.dashboard");
  const locale = useLocale() as Locale;
  const dateLabel = (value: string) =>
    formatLocalizedDate(new Date(value), locale, { dateStyle: "medium" });

  return (
    <section className="mt-6 rounded-lg border border-line bg-surface p-5">
      <h2 className="text-heading font-bold text-ink">{t("prescriptions")}</h2>
      {chains.length === 0 ? (
        <p className="mt-3 text-small text-neutral-500">{t("noPrescriptions")}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {chains.map((chain) => {
            const latest = chain.revisions[chain.revisions.length - 1]!;
            return (
              <li
                key={latest.prescriptionId}
                className="rounded-md border border-line bg-canvas px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-body font-semibold text-ink">{latest.medicationName}</p>
                  <span
                    className={`rounded-sm px-2 py-0.5 text-caption font-semibold ${
                      latest.status === "active"
                        ? "bg-success-soft text-success"
                        : "bg-neutral-100 text-neutral-500"
                    }`}
                  >
                    {t(`prescription_${latest.status}`)}
                  </span>
                </div>
                <p className="mt-1 text-small text-neutral-600">
                  {latest.dosage} · {latest.frequency} · {latest.duration}
                </p>
                {latest.instructions && (
                  <p className="mt-1 text-small text-neutral-500">{latest.instructions}</p>
                )}
                <p className="mt-1 text-caption text-neutral-400" dir="ltr">
                  {dateLabel(latest.issuedAt)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
