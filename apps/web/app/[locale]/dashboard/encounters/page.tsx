"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@mesomed/i18n";
import { trpc } from "../../../../lib/trpc";

const field =
  "h-11 w-full rounded-md border border-line bg-canvas px-3 text-body text-ink shadow-card outline-none transition-shadow duration-fast placeholder:text-neutral-400 focus:border-brand";

/**
 * Doctor encounters (Phase 8 dashboards): completed visits with their
 * notes and prescriptions. Corrections are amendments — the API never
 * UPDATEs clinical content (§3.5); the UI only ever appends.
 */
export default function EncountersPage() {
  const t = useTranslations("web.dashboard");
  const locale = useLocale() as Locale;
  const encounters = trpc.clinical.doctorEncounters.useQuery();
  const [openId, setOpenId] = useState<string | null>(null);

  if (encounters.isLoading) {
    return (
      <main className="animate-pulse py-8">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="mb-3 h-16 rounded-lg bg-neutral-100" />
        ))}
      </main>
    );
  }

  const rows = encounters.data?.encounters ?? [];
  const dateLabel = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" });

  return (
    <main className="py-8">
      <h1 className="text-title font-bold text-ink">{t("encountersTitle")}</h1>

      {rows.length === 0 ? (
        <p className="mt-6 rounded-md bg-surface px-4 py-6 text-center text-body text-neutral-500">
          {t("noEncounters")}
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {rows.map((encounter) => (
            <li key={encounter.encounterId} className="rounded-lg border border-line bg-surface">
              <button
                type="button"
                onClick={() =>
                  setOpenId((current) =>
                    current === encounter.encounterId ? null : encounter.encounterId,
                  )
                }
                className="flex w-full items-center justify-between px-4 py-3 text-start"
              >
                <span className="text-body font-semibold text-ink">
                  {dateLabel.format(new Date(encounter.startsAt))}
                </span>
                <span className="text-small text-neutral-500">
                  {openId === encounter.encounterId ? t("collapse") : t("expand")}
                </span>
              </button>
              {openId === encounter.encounterId && (
                <div className="border-t border-line px-4 py-4">
                  <EncounterNotes encounterId={encounter.encounterId} />
                  <PrescriptionComposer encounterId={encounter.encounterId} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function EncounterNotes({ encounterId }: { encounterId: string }) {
  const t = useTranslations("web.dashboard");
  const locale = useLocale() as Locale;
  const utils = trpc.useUtils();
  const notes = trpc.clinical.encounterNotes.useQuery({ encounterId });
  const [content, setContent] = useState("");

  const addNote = trpc.clinical.addVisitNote.useMutation({
    onSuccess: () => {
      setContent("");
      void utils.clinical.encounterNotes.invalidate({ encounterId });
    },
  });

  const stamp = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  function submit(event: FormEvent) {
    event.preventDefault();
    addNote.mutate({ encounterId, content: content.trim() });
  }

  return (
    <section>
      <h3 className="text-body font-bold text-ink">{t("visitNotes")}</h3>
      {notes.isLoading ? (
        <div className="mt-2 h-16 animate-pulse rounded-md bg-neutral-100" />
      ) : (notes.data?.notes.length ?? 0) === 0 ? (
        <p className="mt-2 text-small text-neutral-500">{t("noNotes")}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {notes.data!.notes.map((note) => (
            <li
              key={note.visitNoteId}
              className="rounded-md border border-line bg-canvas px-4 py-3"
            >
              {note.amendsNoteId && (
                <p className="mb-1 text-caption font-semibold text-warning">{t("amendment")}</p>
              )}
              <p className="whitespace-pre-wrap text-body text-neutral-700">{note.content}</p>
              <p className="mt-1 text-caption text-neutral-400">
                {stamp.format(new Date(note.createdAt))}
              </p>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="mt-3">
        <textarea
          required
          rows={3}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder={t("notePlaceholder")}
          className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-body text-ink shadow-card outline-none focus:border-brand"
        />
        {addNote.error && (
          <p className="mt-2 rounded-md bg-danger-soft px-4 py-2 text-small font-medium text-danger">
            {t("saveFailed")}
          </p>
        )}
        <button
          type="submit"
          disabled={addNote.isPending || content.trim().length === 0}
          className="mt-2 rounded-md bg-brand px-5 py-2 text-small font-semibold text-white transition-colors duration-fast hover:bg-brand-strong disabled:opacity-50"
        >
          {t("addNote")}
        </button>
      </form>
    </section>
  );
}

function PrescriptionComposer({ encounterId }: { encounterId: string }) {
  const t = useTranslations("web.dashboard");
  const [open, setOpen] = useState(false);
  const [medicationName, setMedicationName] = useState("");
  const [dosage, setDosage] = useState("");
  const [frequency, setFrequency] = useState("");
  const [duration, setDuration] = useState("");
  const [instructions, setInstructions] = useState("");

  const issue = trpc.clinical.issuePrescription.useMutation({
    onSuccess: () => {
      setMedicationName("");
      setDosage("");
      setFrequency("");
      setDuration("");
      setInstructions("");
      setOpen(false);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    issue.mutate({
      encounterId,
      medicationName: medicationName.trim(),
      dosage: dosage.trim(),
      frequency: frequency.trim(),
      duration: duration.trim(),
      ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
    });
  }

  return (
    <section className="mt-5 border-t border-line pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-body font-bold text-ink">{t("prescriptions")}</h3>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md border border-line px-4 py-1.5 text-small font-medium text-neutral-600 transition-colors duration-fast hover:border-brand hover:text-ink"
          >
            {t("issuePrescription")}
          </button>
        )}
      </div>

      {issue.data && (
        <p className="mt-2 rounded-md bg-success-soft px-4 py-2 text-small font-medium text-success">
          {t("prescriptionIssued")}
        </p>
      )}

      {open && (
        <form onSubmit={submit} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
            {t("medicationName")}
            <input
              required
              value={medicationName}
              onChange={(event) => setMedicationName(event.target.value)}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
            {t("dosage")}
            <input
              required
              value={dosage}
              onChange={(event) => setDosage(event.target.value)}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
            {t("frequency")}
            <input
              required
              value={frequency}
              onChange={(event) => setFrequency(event.target.value)}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
            {t("duration")}
            <input
              required
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1 text-small font-medium text-neutral-600 sm:col-span-2">
            {t("instructions")}
            <input
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              className={field}
            />
          </label>
          {issue.error && (
            <p className="rounded-md bg-danger-soft px-4 py-2 text-small font-medium text-danger sm:col-span-2">
              {t("saveFailed")}
            </p>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={issue.isPending}
              className="rounded-md bg-brand px-5 py-2 text-small font-semibold text-white transition-colors duration-fast hover:bg-brand-strong disabled:opacity-50"
            >
              {t("issue")}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-4 py-2 text-small font-medium text-neutral-500 hover:text-ink"
            >
              {t("cancelEdit")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
