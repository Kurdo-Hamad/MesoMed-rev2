import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useTranslations } from "use-intl";
import { FilterChips } from "../../components/filter-chips";
import { CardSkeleton, DoctorCard } from "../../components/listing-cards";
import { useLocale } from "../../lib/locale";
import { pickText } from "../../lib/localized";
import { trpc } from "../../lib/trpc";

const PAGE_SIZE = 12;

/** Doctor browse: specialty + city filters, keyset pagination. `specialty`
 * param pre-selects (symptom triage links land here). Parity with
 * apps/web/app/[locale]/directory/doctors/page.tsx. */
export default function DoctorsBrowseScreen() {
  const { specialty } = useLocalSearchParams<{ specialty?: string }>();
  const t = useTranslations("web.directory");
  const { locale } = useLocale();
  const [specialtyKey, setSpecialtyKey] = useState<string | undefined>(specialty);
  const [citySlug, setCitySlug] = useState<string | undefined>(undefined);

  const specialties = trpc.directory.listSpecialties.useQuery();
  const cities = trpc.directory.listCities.useQuery();
  const doctors = trpc.directory.browseDoctors.useInfiniteQuery(
    { specialtyKey, citySlug, limit: PAGE_SIZE },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
  );

  const items = doctors.data?.pages.flatMap((page) => page.items) ?? [];
  const specialtyOptions = [
    { value: "", label: t("allSpecialties") },
    ...(specialties.data?.specialties ?? [])
      .filter((s) => s.active)
      .map((s) => ({ value: s.key, label: pickText(s.name, locale) })),
  ];
  const cityOptions = [
    { value: "", label: t("allCities") },
    ...(cities.data?.cities ?? [])
      .filter((city) => city.active)
      .map((city) => ({ value: city.slug, label: pickText(city.name, locale) })),
  ];

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-4 pb-10">
      <Stack.Screen options={{ title: t("doctors") }} />
      <FilterChips
        value={specialtyKey ?? ""}
        onChange={(value) => setSpecialtyKey(value || undefined)}
        options={specialtyOptions}
      />
      <View className="mt-2">
        <FilterChips
          value={citySlug ?? ""}
          onChange={(value) => setCitySlug(value || undefined)}
          options={cityOptions}
        />
      </View>

      {doctors.isLoading ? (
        <View className="mt-6 flex-row flex-wrap gap-3">
          {Array.from({ length: PAGE_SIZE }, (_, index) => (
            <View key={index} className="w-[47%]">
              <CardSkeleton />
            </View>
          ))}
        </View>
      ) : items.length === 0 ? (
        <Text className="mt-6 rounded-lg border border-line bg-surface px-4 py-10 text-center text-body text-neutral-500">
          {t("empty")}
        </Text>
      ) : (
        <>
          <View className="mt-6 flex-row flex-wrap gap-3">
            {items.map((doctor) => (
              <View key={doctor.slug} className="w-[47%]">
                <DoctorCard doctor={doctor} />
              </View>
            ))}
          </View>
          {doctors.hasNextPage && (
            <Pressable
              onPress={() => void doctors.fetchNextPage()}
              disabled={doctors.isFetchingNextPage}
              className="mt-6 self-center rounded-md border border-line bg-canvas px-6 py-2.5 disabled:opacity-50"
            >
              <Text className="text-small font-medium text-ink">{t("loadMore")}</Text>
            </Pressable>
          )}
        </>
      )}
    </ScrollView>
  );
}
