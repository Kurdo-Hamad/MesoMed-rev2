import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Stack } from "expo-router";
import { useTranslations } from "use-intl";
import { formatLocalizedDate } from "@mesomed/i18n";
import { useLocale } from "../../lib/locale";
import { trpc } from "../../lib/trpc";

/**
 * Patient encounters: read-only visit history via clinical.myEncounters,
 * expandable to the encounter's notes (clinical.encounterNotes — the
 * patient is a permitted reader of their own encounters). NO note
 * composer and NO prescription composer here: those are the doctor's
 * tools (apps/web dashboard/encounters), which are Phase 9b scope.
 */
export default function EncountersScreen() {
  const t = useTranslations("web.dashboard");
  const { locale } = useLocale();
  const encounters = trpc.clinical.myEncounters.useQuery();
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = encounters.data?.encounters ?? [];
  const dateLabel = (value: string) =>
    formatLocalizedDate(new Date(value), locale, { dateStyle: "full", timeStyle: "short" });

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-4 pb-10">
      <Stack.Screen options={{ title: t("encountersTitle") }} />
      <Text className="text-title font-bold text-ink">{t("encountersTitle")}</Text>

      {encounters.isLoading ? (
        <View className="mt-6 gap-3">
          {Array.from({ length: 3 }, (_, index) => (
            <View key={index} className="h-16 rounded-lg bg-neutral-100" />
          ))}
        </View>
      ) : rows.length === 0 ? (
        <Text className="mt-6 rounded-md bg-surface px-4 py-6 text-center text-body text-neutral-500">
          {t("noEncounters")}
        </Text>
      ) : (
        <View className="mt-6 gap-3">
          {rows.map((encounter) => (
            <View key={encounter.encounterId} className="rounded-lg border border-line bg-surface">
              <Pressable
                onPress={() =>
                  setOpenId((current) =>
                    current === encounter.encounterId ? null : encounter.encounterId,
                  )
                }
                className="flex-row items-center justify-between px-4 py-3"
              >
                <Text
                  className="text-body font-semibold text-ink"
                  style={{ writingDirection: "ltr" }}
                >
                  {dateLabel(encounter.startsAt)}
                </Text>
                <Text className="text-small text-neutral-500">
                  {openId === encounter.encounterId ? t("collapse") : t("expand")}
                </Text>
              </Pressable>
              {openId === encounter.encounterId && (
                <View className="border-t border-line px-4 py-4">
                  <EncounterNotes encounterId={encounter.encounterId} />
                </View>
              )}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function EncounterNotes({ encounterId }: { encounterId: string }) {
  const t = useTranslations("web.dashboard");
  const { locale } = useLocale();
  const notes = trpc.clinical.encounterNotes.useQuery({ encounterId });

  const stamp = (value: string) =>
    formatLocalizedDate(new Date(value), locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <View>
      <Text className="text-body font-bold text-ink">{t("visitNotes")}</Text>
      {notes.isLoading ? (
        <View className="mt-2 h-16 rounded-md bg-neutral-100" />
      ) : (notes.data?.notes.length ?? 0) === 0 ? (
        <Text className="mt-2 text-small text-neutral-500">{t("noNotes")}</Text>
      ) : (
        <View className="mt-2 gap-2">
          {notes.data!.notes.map((note) => (
            <View
              key={note.visitNoteId}
              className="rounded-md border border-line bg-canvas px-4 py-3"
            >
              {note.amendsNoteId && (
                <Text className="mb-1 text-caption font-semibold text-warning">
                  {t("amendment")}
                </Text>
              )}
              <Text className="text-body text-neutral-700">{note.content}</Text>
              <Text
                className="mt-1 text-caption text-neutral-400"
                style={{ writingDirection: "ltr" }}
              >
                {stamp(note.createdAt)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
