import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useTranslations } from "use-intl";
import { FilterChips } from "../../components/filter-chips";
import { CardSkeleton, FacilityCard } from "../../components/listing-cards";
import { useLocale } from "../../lib/locale";
import { pickText } from "../../lib/localized";
import { trpc } from "../../lib/trpc";

const PAGE_SIZE = 12;

/** Facility browse for one category: keyset pagination + city filter.
 * Parity with apps/web/app/[locale]/directory/[category]/page.tsx. */
export default function CategoryBrowseScreen() {
  const { category } = useLocalSearchParams<{ category: string }>();
  const t = useTranslations("web.directory");
  const { locale } = useLocale();
  const [citySlug, setCitySlug] = useState<string | undefined>(undefined);

  const categories = trpc.directory.listCategories.useQuery();
  const cities = trpc.directory.listCities.useQuery();
  const facilities = trpc.directory.browseFacilities.useInfiniteQuery(
    { categorySlug: category, citySlug, limit: PAGE_SIZE },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
  );

  const categoryRow = categories.data?.categories.find((row) => row.slug === category);
  const items = facilities.data?.pages.flatMap((page) => page.items) ?? [];
  const cityOptions = [
    { value: "", label: t("allCities") },
    ...(cities.data?.cities ?? [])
      .filter((city) => city.active)
      .map((city) => ({ value: city.slug, label: pickText(city.name, locale) })),
  ];

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-4 pb-10">
      <Stack.Screen
        options={{ title: categoryRow ? pickText(categoryRow.name, locale) : t("title") }}
      />
      <FilterChips
        value={citySlug ?? ""}
        onChange={(value) => setCitySlug(value || undefined)}
        options={cityOptions}
      />

      {facilities.isLoading ? (
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
            {items.map((facility) => (
              <View key={facility.slug} className="w-[47%]">
                <FacilityCard facility={facility} />
              </View>
            ))}
          </View>
          {facilities.hasNextPage && (
            <Pressable
              onPress={() => void facilities.fetchNextPage()}
              disabled={facilities.isFetchingNextPage}
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
