import { ScrollView, Text, View } from "react-native";
import { Link } from "expo-router";
import { useTranslations } from "use-intl";
import { colors } from "@mesomed/ui-tokens";
import { CardSkeleton, DoctorCard, FacilityCard } from "../../components/listing-cards";
import { CategoryIcon } from "../../components/category-icon";
import { useLocale } from "../../lib/locale";
import { pickText } from "../../lib/localized";
import { trpc } from "../../lib/trpc";

const FEED_LIMIT = 8;

/**
 * Homepage: hero + category grid + recommended feed. Parity with
 * apps/web/app/[locale]/page.tsx — same published queries
 * (directory.listCategories, directory.homepageFeed), no new API surface.
 */
export default function HomeScreen() {
  const { locale } = useLocale();
  const tHero = useTranslations("web.home.hero");
  const tCategories = useTranslations("web.home.categories");
  const tFeed = useTranslations("web.home.feed");

  const categories = trpc.directory.listCategories.useQuery();
  const feed = trpc.directory.homepageFeed.useQuery({ limit: FEED_LIMIT });

  const activeCategories = (categories.data?.categories ?? []).filter((c) => c.active);
  const slots = feed.data?.slots ?? [];

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="pb-10">
      <View className="gap-3 bg-brand-soft px-4 pb-8 pt-6">
        <Text className="text-title font-bold text-ink">{tHero("title")}</Text>
        <Text className="text-body text-neutral-600">{tHero("subtitle")}</Text>
      </View>

      <View className="px-4 pt-6">
        <Text className="mb-3 text-heading font-bold text-ink">{tCategories("heading")}</Text>
        <View className="flex-row flex-wrap gap-3">
          {activeCategories.map((category) => (
            <Link key={category.slug} href={`/directory/${category.slug}`} asChild>
              <View className="w-[47%] items-center justify-center gap-2 rounded-lg border border-line bg-canvas py-5 shadow-card">
                <CategoryIcon iconKey={category.iconKey} color={colors.brand} />
                <Text className="px-2 text-center text-small font-medium text-ink">
                  {pickText(category.name, locale)}
                </Text>
              </View>
            </Link>
          ))}
        </View>
      </View>

      <View className="px-4 pt-8">
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-heading font-bold text-ink">{tFeed("heading")}</Text>
          <Link href="/directory" className="text-small font-medium text-brand">
            {tFeed("viewDirectory")}
          </Link>
        </View>
        {feed.isLoading ? (
          <View className="flex-row flex-wrap gap-3">
            {Array.from({ length: FEED_LIMIT }, (_, index) => (
              <View key={index} className="w-[47%]">
                <CardSkeleton />
              </View>
            ))}
          </View>
        ) : slots.length === 0 ? (
          <Text className="rounded-lg border border-line bg-surface px-4 py-10 text-center text-body text-neutral-500">
            {tFeed("empty")}
          </Text>
        ) : (
          <View className="flex-row flex-wrap gap-3">
            {slots.map((slot) => (
              <View
                key={slot.kind === "facility" ? `f-${slot.facility.slug}` : `d-${slot.doctor.slug}`}
                className="w-[47%]"
              >
                {slot.kind === "facility" ? (
                  <FacilityCard facility={slot.facility} promoted={slot.promoted} />
                ) : (
                  <DoctorCard doctor={slot.doctor} promoted={slot.promoted} />
                )}
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
