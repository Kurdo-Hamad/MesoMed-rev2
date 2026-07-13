"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatLocalizedDate, type Locale } from "@mesomed/i18n";
import { Link } from "../../../../i18n/navigation";
import { trpc } from "../../../../lib/trpc";

const CANCELLABLE = new Set(["booked", "confirmed"]);

/**
 * Patient appointments (Phase 8 dashboards): own bookings via
 * booking.myAppointments with optimistic cancel — the row greys out
 * immediately and reverts if the API rejects the transition.
 */
export default function PatientAppointmentsPage() {
  const t = useTranslations("web.dashboard");
  const locale = useLocale() as Locale;
  const utils = trpc.useUtils();
  const appointments = trpc.booking.myAppointments.useQuery();
  const [failedId, setFailedId] = useState<string | null>(null);

  const cancel = trpc.booking.cancel.useMutation({
    onMutate: async ({ appointmentId }) => {
      setFailedId(null);
      await utils.booking.myAppointments.cancel();
      const previous = utils.booking.myAppointments.getData();
      utils.booking.myAppointments.setData(undefined, (current) =>
        current
          ? {
              appointments: current.appointments.map((appointment) =>
                appointment.appointmentId === appointmentId
                  ? { ...appointment, status: "cancelled" as const }
                  : appointment,
              ),
            }
          : current,
      );
      return { previous };
    },
    onError: (_error, { appointmentId }, context) => {
      if (context?.previous) utils.booking.myAppointments.setData(undefined, context.previous);
      setFailedId(appointmentId);
    },
    onSettled: () => utils.booking.myAppointments.invalidate(),
  });

  if (appointments.isLoading) {
    return (
      <main className="animate-pulse py-8">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="mb-3 h-20 rounded-lg bg-neutral-100" />
        ))}
      </main>
    );
  }

  const rows = appointments.data?.appointments ?? [];
  const dateLabel = (value: string) =>
    formatLocalizedDate(new Date(value), locale, { dateStyle: "full", timeStyle: "short" });

  return (
    <main className="py-8">
      <h1 className="text-title font-bold text-ink">{t("appointmentsTitle")}</h1>

      {failedId && (
        <p className="mt-4 rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger">
          {t("cancelFailed")}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="mt-6 rounded-lg border border-line bg-surface p-8 text-center">
          <p className="text-body text-neutral-500">{t("noAppointments")}</p>
          <Link
            href="/directory/doctors"
            className="mt-4 inline-block rounded-md bg-brand px-6 py-2.5 text-body font-semibold text-white transition-colors duration-fast hover:bg-brand-strong"
          >
            {t("findDoctor")}
          </Link>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {rows.map((appointment) => (
            <li
              key={appointment.appointmentId}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4 ${
                appointment.status === "cancelled" ? "opacity-60" : ""
              }`}
            >
              <div>
                <p className="text-body font-semibold text-ink" dir="ltr">
                  {dateLabel(appointment.startsAt)}
                </p>
                <p className="mt-0.5 text-small text-neutral-500">
                  {t(`status_${appointment.status}`)}
                </p>
              </div>
              {CANCELLABLE.has(appointment.status) && (
                <button
                  type="button"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate({ appointmentId: appointment.appointmentId })}
                  className="rounded-md border border-line px-4 py-2 text-small font-medium text-neutral-600 transition-colors duration-fast hover:border-danger hover:text-danger disabled:opacity-50"
                >
                  {t("cancelAppointment")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
