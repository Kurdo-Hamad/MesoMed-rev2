import { Pressable, ScrollView, Text, View } from "react-native";
import { UserRound } from "lucide-react-native";
import { Link, Stack } from "expo-router";
import { useTranslations } from "use-intl";
import { colors } from "@mesomed/ui-tokens";
import { CategoryIcon } from "../../components/category-icon";
import { isBookableCategory } from "../../lib/category-filter";
import { useLocale } from "../../lib/locale";
import { pickText } from "../../lib/localized";
import { trpc } from "../../lib/trpc";

/** Directory landing: every active, bookable category (data-driven —
 * MM-PLAN-001 §3.9) plus the doctors entry. `coming_soon` categories are
 * excluded until mobile gains the tile surface (MM-QA-005 F-02). Parity
 * with apps/web/app/[locale]/directory/page.tsx. */
export default function DirectoryScreen() {
  const t = useTranslations("web.directory");
  const { locale } = useLocale();
  const categories = trpc.directory.listCategories.useQuery();

  const items = (categories.data?.categories ?? []).filter(isBookableCategory);

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-4 pb-10">
      <Stack.Screen options={{ title: t("title") }} />
      <Text className="text-title font-bold text-ink">{t("title")}</Text>
      <Text className="mt-1 text-body text-neutral-600">{t("subtitle")}</Text>

      <View className="mt-6 gap-3">
        <Link href="/directory/doctors" asChild>
          <Pressable className="flex-row items-center gap-4 rounded-lg border border-line bg-canvas p-5 shadow-card">
            <View className="h-12 w-12 items-center justify-center rounded-md bg-brand-soft">
              <UserRound size={24} color={colors.brand} />
            </View>
            <View>
              <Text className="text-subtitle font-semibold text-ink">{t("doctors")}</Text>
              <Text className="text-small text-neutral-500">{t("doctorsSubtitle")}</Text>
            </View>
          </Pressable>
        </Link>

        {categories.isLoading
          ? Array.from({ length: 5 }, (_, index) => (
              <View
                key={index}
                className="h-[5.5rem] rounded-lg border border-line bg-neutral-100"
              />
            ))
          : items.map((category) => (
              <Link key={category.slug} href={`/directory/${category.slug}`} asChild>
                <Pressable className="flex-row items-center gap-4 rounded-lg border border-line bg-canvas p-5 shadow-card">
                  <View className="h-12 w-12 items-center justify-center rounded-md bg-brand-soft">
                    <CategoryIcon iconKey={category.iconKey} color={colors.brand} />
                  </View>
                  <Text className="text-subtitle font-semibold text-ink">
                    {pickText(category.name, locale)}
                  </Text>
                </Pressable>
              </Link>
            ))}
      </View>
    </ScrollView>
  );
}
