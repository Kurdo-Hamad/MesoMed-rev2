import { useState } from "react";
import { I18nManager, Pressable, ScrollView, Text, View } from "react-native";
import { Stack } from "expo-router";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useTranslations } from "use-intl";
import { formatLocalizedDate } from "@mesomed/i18n";
import { colors } from "@mesomed/ui-tokens";
import { FilterChips } from "../components/filter-chips";
import { useLocale } from "../lib/locale";
import { pickText } from "../lib/localized";
import { trpc } from "../lib/trpc";

/**
 * Clinic day queue (Phase 9b Slice 3, read-only): doctors and secretaries
 * share the screen; per-appointment affordances come EXCLUSIVELY from the
 * server-computed allowedActions field (MM-QA-003 F-07) — this client
 * holds no status rules. Slice 3 renders them display-only; the wired
 * mutations land in Slice 4. Layer-a/b authorization is entirely
 * server-side; this screen only shows what the session can access.
 */
export default function ClinicScreen() {
  const t = useTranslations("web.dashboard");
  const { locale } = useLocale();
  const workplaces = trpc.scheduling.myWorkplaces.useQuery();
  const [workplaceId, setWorkplaceId] = useState<string | undefined>(undefined);
  const [dayOffset, setDayOffset] = useState(0);

  const list = workplaces.data?.workplaces ?? [];
  const selected = list.find((w) => w.doctorLocationId === workplaceId) ?? list[0];
  // Navigation math only — the server derives the actual day window in the
  // location timezone from the anchor instant.
  const anchor = new Date(Date.now() + dayOffset * 86_400_000);

  const day = trpc.booking.clinicDay.useQuery(
    { doctorLocationId: selected?.doctorLocationId ?? "", anchor: anchor.toISOString() },
    { enabled: selected !== undefined },
  );

  const timeLabel = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: day.data?.timeZone,
    }).format(new Date(value));
  const dateLabel = day.data
    ? formatLocalizedDate(new Date(`${day.data.date}T12:00:00`), locale, {
        dateStyle: "full",
        timeZone: day.data.timeZone,
      })
    : "";

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-4 pb-10">
      <Stack.Screen options={{ title: t("clinicTitle") }} />
      <Text className="text-title font-bold text-ink">{t("clinicTitle")}</Text>

      {workplaces.isLoading ? (
        <View className="mt-6 gap-3">
          {Array.from({ length: 3 }, (_, index) => (
            <View key={index} className="h-16 rounded-lg bg-neutral-100" />
          ))}
        </View>
      ) : !selected ? (
        <View className="mt-6 rounded-lg border border-line bg-surface p-6">
          <Text className="text-body text-neutral-500">{t("noWorkplaces")}</Text>
        </View>
      ) : (
        <>
          {list.length > 1 && (
            <View className="mt-4 gap-1">
              <Text className="text-small font-medium text-neutral-600">{t("workplace")}</Text>
              <FilterChips
                value={selected.doctorLocationId}
                onChange={setWorkplaceId}
                options={list.map((workplace) => ({
                  value: workplace.doctorLocationId,
                  label: pickText(workplace.name, locale),
                }))}
              />
            </View>
          )}

          <View className="mt-6 flex-row items-center justify-between">
            <Text className="text-heading font-bold text-ink" style={{ writingDirection: "ltr" }}>
              {dateLabel}
            </Text>
            <View className="flex-row gap-1">
              {/* Directional controls, not text: glyphs follow native layout
                  direction (I18nManager flips the row automatically). */}
              <DayShiftButton
                label={t("prevDay")}
                onPress={() => setDayOffset((current) => current - 1)}
                backward
              />
              <DayShiftButton
                label={t("nextDay")}
                onPress={() => setDayOffset((current) => current + 1)}
              />
            </View>
          </View>

          {day.isLoading ? (
            <View className="mt-4 gap-2">
              {Array.from({ length: 4 }, (_, index) => (
                <View key={index} className="h-20 rounded-lg bg-neutral-100" />
              ))}
            </View>
          ) : (day.data?.appointments.length ?? 0) === 0 ? (
            <View className="mt-4 items-center rounded-lg border border-line bg-surface p-8">
              <Text className="text-body text-neutral-500">{t("emptyDay")}</Text>
            </View>
          ) : (
            <View className="mt-4 gap-2">
              {day.data!.appointments.map((appointment) => (
                <View
                  key={appointment.appointmentId}
                  className="rounded-lg border border-line bg-surface p-4"
                >
                  <View className="flex-row flex-wrap items-center justify-between gap-2">
                    <Text
                      className="text-body font-bold text-ink"
                      style={{ writingDirection: "ltr" }}
                    >
                      {timeLabel(appointment.startsAt)}
                    </Text>
                    <View className="rounded-sm bg-brand-soft px-2 py-0.5">
                      <Text className="text-caption font-semibold text-brand">
                        {t(`status_${appointment.status}`)}
                      </Text>
                    </View>
                  </View>
                  <Text className="mt-1 text-body font-medium text-ink">
                    {appointment.patientName ?? t("unknownPatient")}
                  </Text>
                  {(appointment.patientPhone || appointment.note) && (
                    <Text className="mt-0.5 text-caption text-neutral-500">
                      <Text style={{ writingDirection: "ltr" }}>
                        {appointment.patientPhone ?? ""}
                      </Text>
                      {appointment.note ? ` · ${appointment.note}` : ""}
                    </Text>
                  )}
                  {appointment.allowedActions.length > 0 && (
                    <View className="mt-3 flex-row flex-wrap gap-2">
                      {appointment.allowedActions.map((action) => (
                        <View
                          key={action}
                          className="rounded-md border border-line bg-canvas px-3 py-1.5 opacity-60"
                        >
                          <Text className="text-caption font-medium text-neutral-600">
                            {t(`action_${action}`)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

function DayShiftButton({
  label,
  onPress,
  backward = false,
}: {
  label: string;
  onPress: () => void;
  backward?: boolean;
}) {
  const showLeft = backward !== I18nManager.isRTL;
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={onPress}
      className="rounded-md border border-line p-2"
    >
      {showLeft ? (
        <ChevronLeft size={16} color={colors.muted} />
      ) : (
        <ChevronRight size={16} color={colors.muted} />
      )}
    </Pressable>
  );
}
