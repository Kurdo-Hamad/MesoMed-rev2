import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Link, Stack } from "expo-router";
import { useTranslations } from "use-intl";
import { formatLocalizedDate } from "@mesomed/i18n";
import { useLocale } from "../../lib/locale";
import { trpc } from "../../lib/trpc";

const CANCELLABLE = new Set(["booked", "confirmed"]);

/**
 * Patient appointments: own bookings via booking.myAppointments with
 * optimistic cancel — the row greys out immediately and reverts if the
 * API rejects the transition. Parity with
 * apps/web/app/[locale]/dashboard/appointments/page.tsx (re-book = find
 * a doctor again; reschedule UI remains a recorded carry-in, ADR-0016 #4).
 */
export default function AppointmentsScreen() {
  const t = useTranslations("web.dashboard");
  const { locale } = useLocale();
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

  const rows = appointments.data?.appointments ?? [];
  const dateLabel = (value: string) =>
    formatLocalizedDate(new Date(value), locale, { dateStyle: "full", timeStyle: "short" });

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-4 pb-10">
      <Stack.Screen options={{ title: t("appointmentsTitle") }} />
      <Text className="text-title font-bold text-ink">{t("appointmentsTitle")}</Text>

      {failedId && (
        <Text className="mt-4 rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger">
          {t("cancelFailed")}
        </Text>
      )}

      {appointments.isLoading ? (
        <View className="mt-6 gap-3">
          {Array.from({ length: 3 }, (_, index) => (
            <View key={index} className="h-20 rounded-lg bg-neutral-100" />
          ))}
        </View>
      ) : rows.length === 0 ? (
        <View className="mt-6 items-center rounded-lg border border-line bg-surface p-8">
          <Text className="text-body text-neutral-500">{t("noAppointments")}</Text>
          <Link href="/directory/doctors" asChild>
            <Pressable className="mt-4 rounded-md bg-brand px-6 py-2.5">
              <Text className="text-body font-semibold text-white">{t("findDoctor")}</Text>
            </Pressable>
          </Link>
        </View>
      ) : (
        <View className="mt-6 gap-3">
          {rows.map((appointment) => (
            <View
              key={appointment.appointmentId}
              className={`flex-row flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4 ${
                appointment.status === "cancelled" ? "opacity-60" : ""
              }`}
            >
              <View className="min-w-0 flex-1">
                <Text
                  className="text-body font-semibold text-ink"
                  style={{ writingDirection: "ltr" }}
                >
                  {dateLabel(appointment.startsAt)}
                </Text>
                <Text className="mt-0.5 text-small text-neutral-500">
                  {t(`status_${appointment.status}`)}
                </Text>
              </View>
              {CANCELLABLE.has(appointment.status) && (
                <Pressable
                  disabled={cancel.isPending}
                  onPress={() => cancel.mutate({ appointmentId: appointment.appointmentId })}
                  className="rounded-md border border-line px-4 py-2 disabled:opacity-50"
                >
                  <Text className="text-small font-medium text-neutral-600">
                    {t("cancelAppointment")}
                  </Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
