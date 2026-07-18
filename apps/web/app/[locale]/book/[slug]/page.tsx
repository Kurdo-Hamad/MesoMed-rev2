"use client";

import { use, useMemo, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { formatLocalizedDate, pinLtr, type Locale } from "@mesomed/i18n";
import { normalizePhone } from "@mesomed/contracts/phone";
import { FilterSelect } from "../../../../components/filter-select";
import { Link } from "../../../../i18n/navigation";
import { classifyBookingError } from "../../../../lib/booking-error";
import { pickText } from "../../../../lib/localized";
import { trpc } from "../../../../lib/trpc";

/**
 * Guest booking (MM-DEC rev02 §1, convention #7): friction-free — no
 * account, no OTP. Name + phone required; DOB/gender/email optional. The
 * API creates/finds the phone-keyed patient profile; the confirmation
 * screen then offers the optional account (§2) — never as a precondition.
 */
export default function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const t = useTranslations("web.book");
  const tDoctor = useTranslations("web.doctor");
  const locale = useLocale() as Locale;

  const doctor = trpc.directory.doctorDetail.useQuery({ slugOrId: slug });
  const locations = trpc.scheduling.doctorLocations.useQuery(
    { doctorProfileId: doctor.data?.id ?? "" },
    { enabled: Boolean(doctor.data?.id) },
  );

  const [locationId, setLocationId] = useState<string | undefined>(undefined);
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [slot, setSlot] = useState<{ startsAt: string; endsAt: string } | null>(null);

  const activeLocations = useMemo(
    () => (locations.data?.locations ?? []).filter((location) => location.active),
    [locations.data],
  );
  const selectedLocationId = locationId ?? activeLocations[0]?.doctorLocationId;

  const availability = trpc.booking.weekAvailability.useQuery(
    { doctorLocationId: selectedLocationId ?? "", anchor: anchor.toISOString() },
    { enabled: Boolean(selectedLocationId) },
  );

  const book = trpc.booking.guestBook.useMutation();

  if (doctor.error) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-20 text-center">
        <p className="text-subtitle text-neutral-500">{tDoctor("notFound")}</p>
      </main>
    );
  }

  if (book.data) {
    return <Confirmation result={book.data} phone={book.variables?.patient.phone ?? ""} />;
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <h1 className="text-title font-bold text-ink">{t("title")}</h1>
      {doctor.data && (
        <p className="mt-1 text-subtitle text-neutral-600">
          {t("with", { name: pickText(doctor.data.name, locale) })}
        </p>
      )}

      {activeLocations.length > 1 && (
        <div className="mt-6">
          <label className="mb-1 block text-small font-medium text-neutral-600">
            {t("location")}
          </label>
          <FilterSelect
            label={t("location")}
            value={selectedLocationId ?? ""}
            onChange={(value) => {
              setLocationId(value);
              setSlot(null);
            }}
          >
            {activeLocations.map((location) => (
              <option key={location.doctorLocationId} value={location.doctorLocationId}>
                {pickText(location.name, locale)}
              </option>
            ))}
          </FilterSelect>
        </div>
      )}

      <WeekGrid
        availability={availability.data}
        loading={availability.isLoading || locations.isLoading || doctor.isLoading}
        selected={slot}
        onSelect={setSlot}
        onWeekShift={(days) => {
          setAnchor((current) => new Date(current.getTime() + days * 86_400_000));
          setSlot(null);
        }}
      />

      {slot && selectedLocationId && (
        <PatientForm
          slot={slot}
          doctorLocationId={selectedLocationId}
          pending={book.isPending}
          error={book.error ? classifyBookingError(book.error) : null}
          onSubmit={(input) => book.mutate(input)}
        />
      )}
    </main>
  );
}

interface Availability {
  timeZone: string;
  days: Array<{
    date: string;
    isOpen: boolean;
    isPast: boolean;
    isToday: boolean;
    slots: Array<{ startsAt: string; endsAt: string }>;
  }>;
}

function WeekGrid({
  availability,
  loading,
  selected,
  onSelect,
  onWeekShift,
}: {
  availability: Availability | undefined;
  loading: boolean;
  selected: { startsAt: string } | null;
  onSelect: (slot: { startsAt: string; endsAt: string }) => void;
  onWeekShift: (days: number) => void;
}) {
  const t = useTranslations("web.book");
  const locale = useLocale() as Locale;

  const dayLabel = useMemo(
    () => (date: Date) =>
      formatLocalizedDate(date, locale, { weekday: "short", day: "numeric", month: "short" }),
    [locale],
  );
  const timeLabel = useMemo(
    () =>
      availability
        ? new Intl.DateTimeFormat(locale, {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: availability.timeZone,
          })
        : null,
    [locale, availability],
  );

  const hasAnySlot = availability?.days.some((day) => day.slots.length > 0) ?? false;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-heading font-bold text-ink">{t("week")}</h2>
        <div className="flex gap-1">
          {/* Chevrons are directional controls, not text: flip via rtl: classes. */}
          <button
            type="button"
            aria-label={t("prevWeek")}
            onClick={() => onWeekShift(-7)}
            className="rounded-md border border-line p-2 text-neutral-600 transition-colors duration-fast hover:border-brand hover:text-ink"
          >
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t("nextWeek")}
            onClick={() => onWeekShift(7)}
            className="rounded-md border border-line p-2 text-neutral-600 transition-colors duration-fast hover:border-brand hover:text-ink"
          >
            <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          </button>
        </div>
      </div>

      {loading || !availability ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-7">
          {Array.from({ length: 7 }, (_, index) => (
            <div key={index} className="h-40 animate-pulse rounded-lg bg-neutral-100" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-7">
            {availability.days.map((day) => (
              <div
                key={day.date}
                className={`rounded-lg border p-2 ${day.isToday ? "border-brand" : "border-line"}`}
              >
                <p
                  className="mb-2 text-center text-caption font-semibold text-neutral-600"
                  dir="ltr"
                >
                  {dayLabel(new Date(`${day.date}T12:00:00`))}
                </p>
                {!day.isOpen || day.isPast ? (
                  <p className="py-4 text-center text-caption text-neutral-500">{t("closed")}</p>
                ) : day.slots.length === 0 ? (
                  <p className="py-4 text-center text-caption text-neutral-500">—</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {day.slots.map((daySlot) => (
                      <li key={daySlot.startsAt}>
                        <button
                          type="button"
                          onClick={() => onSelect(daySlot)}
                          className={
                            selected?.startsAt === daySlot.startsAt
                              ? "w-full rounded-sm bg-brand px-2 py-1 text-caption font-semibold text-white"
                              : "w-full rounded-sm bg-brand-soft px-2 py-1 text-caption font-medium text-brand transition-colors duration-fast hover:bg-brand hover:text-white"
                          }
                        >
                          {timeLabel?.format(new Date(daySlot.startsAt))}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          {!hasAnySlot && (
            <p className="mt-3 rounded-md bg-surface px-4 py-3 text-center text-small text-neutral-500">
              {t("noSlots")}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function PatientForm({
  slot,
  doctorLocationId,
  pending,
  error,
  onSubmit,
}: {
  slot: { startsAt: string; endsAt: string };
  doctorLocationId: string;
  pending: boolean;
  error: "slotTaken" | "failed" | null;
  onSubmit: (input: {
    doctorLocationId: string;
    startsAt: string;
    patient: {
      fullName: string;
      phone: string;
      dateOfBirth?: string;
      gender?: "male" | "female";
      email?: string;
    };
    note?: string;
  }) => void;
}) {
  const t = useTranslations("web.book");
  const locale = useLocale() as Locale;
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState<"" | "male" | "female">("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [phoneInvalid, setPhoneInvalid] = useState(false);

  const slotLabel = formatLocalizedDate(new Date(slot.startsAt), locale, {
    dateStyle: "full",
    timeStyle: "short",
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizePhone(phone);
    if (!normalized) {
      setPhoneInvalid(true);
      return;
    }
    setPhoneInvalid(false);
    onSubmit({
      doctorLocationId,
      startsAt: slot.startsAt,
      patient: {
        fullName: fullName.trim(),
        phone: normalized,
        ...(dateOfBirth ? { dateOfBirth } : {}),
        ...(gender ? { gender } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
      },
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  }

  const field =
    "h-11 w-full rounded-md border border-line bg-canvas px-3 text-body text-ink shadow-card outline-none transition-shadow duration-fast placeholder:text-neutral-400 focus:border-brand";

  return (
    <form onSubmit={submit} className="mt-8 rounded-lg border border-line bg-surface p-5">
      <h2 className="text-heading font-bold text-ink">{t("details")}</h2>
      <p className="mt-1 text-small text-neutral-600">
        {t("selectedSlot")}:{" "}
        <span className="font-semibold text-ink" dir="ltr">
          {slotLabel}
        </span>
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
          {t("fullName")}
          <input
            required
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
          {t("phone")}
          <input
            required
            type="tel"
            dir="ltr"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder={t("phoneHint")}
            className={field}
          />
          <span className="font-normal text-caption text-neutral-500">{t("phoneHint")}</span>
        </label>
        <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
          {t("dateOfBirth")}
          <input
            type="date"
            value={dateOfBirth}
            onChange={(event) => setDateOfBirth(event.target.value)}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
          {t("gender")}
          <select
            value={gender}
            onChange={(event) => setGender(event.target.value as "" | "male" | "female")}
            className={field}
          >
            <option value="">{t("genderUnspecified")}</option>
            <option value="male">{t("male")}</option>
            <option value="female">{t("female")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-small font-medium text-neutral-600 sm:col-span-2">
          {t("email")}
          <input
            type="email"
            dir="ltr"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-small font-medium text-neutral-600 sm:col-span-2">
          {t("note")}
          <textarea
            rows={2}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-body text-ink shadow-card outline-none focus:border-brand"
          />
        </label>
      </div>

      {phoneInvalid && (
        <p className="mt-4 rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger">
          {t("invalidPhone")}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger">
          {error === "slotTaken" ? t("slotTaken") : t("failed")}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-5 rounded-md bg-brand px-8 py-3 text-body font-semibold text-white transition-colors duration-fast hover:bg-brand-strong disabled:opacity-50"
      >
        {t("submit")}
      </button>
    </form>
  );
}

function Confirmation({
  result,
  phone,
}: {
  result: { startsAt: string; patientProfileCreated: boolean };
  phone: string;
}) {
  const t = useTranslations("web.book");
  const locale = useLocale() as Locale;
  const when = new Date(result.startsAt);
  const date = pinLtr(formatLocalizedDate(when, locale, { dateStyle: "full" }));
  const time = new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(when);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success-soft">
        <CalendarCheck className="h-8 w-8 text-success" aria-hidden="true" />
      </span>
      <h1 className="mt-5 text-title font-bold text-ink">{t("booked")}</h1>
      <p className="mt-2 text-subtitle text-neutral-700">{t("bookedAt", { date, time })}</p>
      <p className="mt-1 text-body text-neutral-500">{t("confirmationNote")}</p>

      {/* Optional account offer (MM-DEC §2) — after booking, never before. */}
      <div className="mt-10 w-full rounded-lg border border-line bg-surface p-6">
        <p className="text-body text-neutral-700">{t("accountOffer")}</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={`/auth/sign-up?phone=${encodeURIComponent(phone)}`}
            className="rounded-md bg-brand px-6 py-2.5 text-body font-semibold text-white transition-colors duration-fast hover:bg-brand-strong"
          >
            {t("accountOfferCta")}
          </Link>
          <Link
            href="/"
            className="text-small font-medium text-neutral-500 transition-colors duration-fast hover:text-ink"
          >
            {t("accountOfferSkip")}
          </Link>
        </div>
      </div>
    </main>
  );
}
