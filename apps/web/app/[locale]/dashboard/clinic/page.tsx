"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatLocalizedDate, type Locale } from "@mesomed/i18n";
import { normalizePhone } from "@mesomed/contracts/phone";
import { FilterSelect } from "../../../../components/filter-select";
import { pickText } from "../../../../lib/localized";
import { trpc } from "../../../../lib/trpc";

const field =
  "h-11 w-full rounded-md border border-line bg-canvas px-3 text-body text-ink shadow-card outline-none transition-shadow duration-fast placeholder:text-neutral-400 focus:border-brand";

/**
 * Clinic day view (Phase 8 dashboards, migrated onto server affordances in
 * Phase 9c Slice 3 — the ADR-0020 F-07 web follow-up): doctors and
 * secretaries share the queue; per-appointment actions come EXCLUSIVELY
 * from the server-computed allowedActions field — this client holds no
 * status rules, a button exists only when the server offers that action.
 * The API re-checks every transition (layer a/b); a rejected action
 * surfaces the failure banner and the refetch restores server truth.
 */
export default function ClinicPage() {
  const t = useTranslations("web.dashboard");
  const workplaces = trpc.scheduling.myWorkplaces.useQuery();
  const [workplaceId, setWorkplaceId] = useState<string | undefined>(undefined);
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const locale = useLocale() as Locale;

  const list = workplaces.data?.workplaces ?? [];
  const selected = list.find((w) => w.doctorLocationId === workplaceId) ?? list[0];

  if (workplaces.isLoading) {
    return (
      <main className="animate-pulse py-8">
        <div className="h-10 w-1/2 rounded-md bg-neutral-100" />
        <div className="mt-4 h-64 rounded-lg bg-neutral-100" />
      </main>
    );
  }

  if (!selected) {
    return (
      <main className="py-8">
        <p className="rounded-md bg-surface px-4 py-3 text-body text-neutral-500">
          {t("noWorkplaces")}
        </p>
      </main>
    );
  }

  return (
    <main className="py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-title font-bold text-ink">{t("clinicTitle")}</h1>
        {list.length > 1 && (
          <FilterSelect
            label={t("workplace")}
            value={selected.doctorLocationId}
            onChange={setWorkplaceId}
          >
            {list.map((workplace) => (
              <option key={workplace.doctorLocationId} value={workplace.doctorLocationId}>
                {pickText(workplace.name, locale)}
              </option>
            ))}
          </FilterSelect>
        )}
      </div>

      <DayQueue
        doctorLocationId={selected.doctorLocationId}
        anchor={anchor}
        onShiftDay={(days) =>
          setAnchor((current) => new Date(current.getTime() + days * 86_400_000))
        }
      />

      {selected.relation === "assigned_secretary" && (
        <WalkInForm doctorLocationId={selected.doctorLocationId} />
      )}
    </main>
  );
}

/**
 * Actions this build knows how to render and fire (MM-DES-002 §7):
 * allowedActions is server truth, but a server whose action enum has
 * widened past this deploy may offer members with no mutation wired here —
 * rendering them would crash on click. Filtering to the known subset
 * encodes zero state-machine knowledge (F-07 intact) and is permanent
 * forward-compat hardening for every future enum widening.
 */
const KNOWN_ACTIONS = [
  "confirm",
  "checkIn",
  "start",
  "complete",
  "noShow",
  "cancel",
  "delay",
  "recall",
] as const;
type KnownAction = (typeof KNOWN_ACTIONS)[number];
const isKnownAction = (action: string): action is KnownAction =>
  (KNOWN_ACTIONS as readonly string[]).includes(action);

function DayQueue({
  doctorLocationId,
  anchor,
  onShiftDay,
}: {
  doctorLocationId: string;
  anchor: Date;
  onShiftDay: (days: number) => void;
}) {
  const t = useTranslations("web.dashboard");
  const locale = useLocale() as Locale;
  const utils = trpc.useUtils();
  const day = trpc.booking.clinicDay.useQuery({
    doctorLocationId,
    anchor: anchor.toISOString(),
  });

  const invalidate = () => void utils.booking.clinicDay.invalidate();
  const confirm = trpc.booking.confirm.useMutation({ onSettled: invalidate });
  const checkIn = trpc.booking.checkIn.useMutation({ onSettled: invalidate });
  const start = trpc.booking.start.useMutation({ onSettled: invalidate });
  const complete = trpc.booking.complete.useMutation({ onSettled: invalidate });
  const noShow = trpc.booking.noShow.useMutation({ onSettled: invalidate });
  const cancel = trpc.booking.cancel.useMutation({ onSettled: invalidate });
  const delay = trpc.booking.delay.useMutation({ onSettled: invalidate });
  const recall = trpc.booking.recall.useMutation({ onSettled: invalidate });

  const mutations = { confirm, checkIn, start, complete, noShow, cancel, delay, recall } as const;
  const anyPending = Object.values(mutations).some((mutation) => mutation.isPending);
  const anyError = Object.values(mutations).find((mutation) => mutation.error);

  const timeLabel = useMemo(
    () =>
      day.data
        ? new Intl.DateTimeFormat(locale, {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: day.data.timeZone,
          })
        : null,
    [locale, day.data],
  );
  const dateLabel = day.data
    ? formatLocalizedDate(new Date(`${day.data.date}T12:00:00`), locale, {
        dateStyle: "full",
        timeZone: day.data.timeZone,
      })
    : "";

  // Grouping delayed rows below the active list is presentation of server
  // truth (layout), not a client-side status rule — MM-DES-002 §3; the
  // actions on every row still come exclusively from allowedActions.
  const appointments = day.data?.appointments ?? [];
  const activeAppointments = appointments.filter((a) => a.status !== "delayed");
  const delayedAppointments = appointments.filter((a) => a.status === "delayed");

  const renderAppointment = (appointment: (typeof appointments)[number]) => (
    <li
      key={appointment.appointmentId}
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4"
    >
      <div className="flex items-center gap-4">
        <span className="text-body font-bold text-ink" dir="ltr">
          {timeLabel?.format(new Date(appointment.startsAt))}
        </span>
        <div>
          <p className="text-body font-medium text-ink">
            {appointment.patientName ?? t("unknownPatient")}
          </p>
          <p className="text-caption text-neutral-500">
            <span dir="ltr">{appointment.patientPhone ?? ""}</span>
            {appointment.note ? ` · ${appointment.note}` : ""}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-sm bg-brand-soft px-2 py-0.5 text-caption font-semibold text-brand">
          {t(`status_${appointment.status}`)}
        </span>
        {appointment.allowedActions.filter(isKnownAction).map((action) => (
          <button
            key={action}
            type="button"
            disabled={anyPending}
            onClick={() => mutations[action].mutate({ appointmentId: appointment.appointmentId })}
            className={
              action === "cancel" || action === "noShow"
                ? "rounded-md border border-line px-3 py-1.5 text-caption font-medium text-neutral-600 transition-colors duration-fast hover:border-danger hover:text-danger disabled:opacity-50"
                : "rounded-md bg-brand px-3 py-1.5 text-caption font-semibold text-white transition-colors duration-fast hover:bg-brand-strong disabled:opacity-50"
            }
          >
            {t(`action_${action}`)}
          </button>
        ))}
      </div>
    </li>
  );

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-heading font-bold text-ink" dir="ltr">
          {dateLabel}
        </h2>
        <div className="flex gap-1">
          {/* Chevrons are directional controls, not text: flip via rtl: classes. */}
          <button
            type="button"
            aria-label={t("prevDay")}
            onClick={() => onShiftDay(-1)}
            className="rounded-md border border-line p-2 text-neutral-600 transition-colors duration-fast hover:border-brand hover:text-ink"
          >
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t("nextDay")}
            onClick={() => onShiftDay(1)}
            className="rounded-md border border-line p-2 text-neutral-600 transition-colors duration-fast hover:border-brand hover:text-ink"
          >
            <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          </button>
        </div>
      </div>

      {anyError && (
        <p className="mb-3 rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger">
          {t("actionFailed")}
        </p>
      )}

      {day.isLoading ? (
        <div className="animate-pulse">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="mb-2 h-16 rounded-lg bg-neutral-100" />
          ))}
        </div>
      ) : appointments.length === 0 ? (
        <p className="rounded-md bg-surface px-4 py-6 text-center text-body text-neutral-500">
          {t("emptyDay")}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">{activeAppointments.map(renderAppointment)}</ul>
          {delayedAppointments.length > 0 && (
            <div className="mt-6">
              <h3 className="text-small font-medium text-neutral-600">{t("status_delayed")}</h3>
              <ul className="mt-2 flex flex-col gap-2">
                {delayedAppointments.map(renderAppointment)}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function WalkInForm({ doctorLocationId }: { doctorLocationId: string }) {
  const t = useTranslations("web.dashboard");
  const tBook = useTranslations("web.book");
  const locale = useLocale() as Locale;
  const utils = trpc.useUtils();

  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [slot, setSlot] = useState("");
  const [phoneInvalid, setPhoneInvalid] = useState(false);

  const availability = trpc.booking.weekAvailability.useQuery(
    { doctorLocationId },
    { enabled: open },
  );
  const book = trpc.booking.secretaryBook.useMutation({
    onSuccess: () => {
      setFullName("");
      setPhone("");
      setSlot("");
      void utils.booking.clinicDay.invalidate();
      void utils.booking.weekAvailability.invalidate();
    },
  });

  const slots = useMemo(
    () =>
      (availability.data?.days ?? [])
        .filter((availableDay) => !availableDay.isPast)
        .flatMap((availableDay) => availableDay.slots),
    [availability.data],
  );
  const slotLabel = useMemo(
    () =>
      availability.data
        ? (date: Date) =>
            formatLocalizedDate(date, locale, {
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: availability.data!.timeZone,
            })
        : null,
    [locale, availability.data],
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizePhone(phone);
    if (!normalized) {
      setPhoneInvalid(true);
      return;
    }
    setPhoneInvalid(false);
    book.mutate({
      doctorLocationId,
      startsAt: slot,
      patient: { fullName: fullName.trim(), phone: normalized },
    });
  }

  return (
    <section className="mt-8 rounded-lg border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-heading font-bold text-ink">{t("walkInTitle")}</h2>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md bg-brand px-4 py-2 text-small font-semibold text-white transition-colors duration-fast hover:bg-brand-strong"
          >
            {t("walkInOpen")}
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
            {tBook("fullName")}
            <input
              required
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
            {tBook("phone")}
            <input
              required
              type="tel"
              dir="ltr"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder={tBook("phoneHint")}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
            {t("slot")}
            <select
              required
              value={slot}
              onChange={(event) => setSlot(event.target.value)}
              className={field}
            >
              <option value="">—</option>
              {slots.map((option) => (
                <option key={option.startsAt} value={option.startsAt} dir="ltr">
                  {slotLabel?.(new Date(option.startsAt))}
                </option>
              ))}
            </select>
          </label>

          {phoneInvalid && (
            <p className="rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger sm:col-span-3">
              {tBook("invalidPhone")}
            </p>
          )}
          {book.error && (
            <p className="rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger sm:col-span-3">
              {tBook("failed")}
            </p>
          )}
          {book.data && (
            <p className="rounded-md bg-success-soft px-4 py-3 text-small font-medium text-success sm:col-span-3">
              {t("walkInBooked")}
            </p>
          )}

          <div className="flex gap-2 sm:col-span-3">
            <button
              type="submit"
              disabled={book.isPending}
              className="rounded-md bg-brand px-6 py-2 text-small font-semibold text-white transition-colors duration-fast hover:bg-brand-strong disabled:opacity-50"
            >
              {t("walkInSubmit")}
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
