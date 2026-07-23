import { Image, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { Link } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronDown, Menu, Search, UserRound } from "lucide-react-native";
import { useTranslations } from "use-intl";
import { colors } from "@mesomed/ui-tokens";
import type { Locale } from "@mesomed/i18n";
import { CardSkeleton, DoctorCard, FacilityCard } from "../../components/listing-cards";
import { HeroCarousel } from "../../components/hero-carousel";
import { Scrim } from "../../components/scrim";
import {
  CATEGORY_TILE_FALLBACK,
  CATEGORY_TILE_IMAGES,
  DOCTORS_TILE_IMAGE,
} from "../../constants/placeholder-images";
import { useLocale } from "../../lib/locale";
import { pickText } from "../../lib/localized";
import { trpc } from "../../lib/trpc";

const FEED_LIMIT = 8;

// Provider signup stays on the web (MM-DEC rev02; the mobile sign-up screen
// is patient-only) — same env var + fallback as the account screen's legal
// links.
const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? "https://mesomed.krd";

/**
 * Homepage: topbar + language row + ad carousel + headline + search row +
 * photo category grid + recommended feed. Same published queries as before
 * (directory.listCategories, directory.homepageFeed), no new API surface —
 * the search row is a navigation affordance into the wired /search tab and
 * the Country/City fields are visual only (mobile is IQ-pinned, ADR-0055 §8).
 */
export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { locale, setLocale } = useLocale();
  const tBrand = useTranslations("web.brand");
  const tHome = useTranslations("mobile.home");
  const tHero = useTranslations("web.home.hero");
  const tCountry = useTranslations("web.countrySwitcher");
  const tDirectory = useTranslations("web.directory");
  const tCategories = useTranslations("web.home.categories");
  const tTiles = useTranslations("web.home.tiles");
  const tFeed = useTranslations("web.home.feed");

  const categories = trpc.directory.listCategories.useQuery();
  const feed = trpc.directory.homepageFeed.useQuery({ limit: FEED_LIMIT });

  const activeCategories = (categories.data?.categories ?? []).filter((c) => c.active);
  const slots = feed.data?.slots ?? [];

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="pb-10">
      {/* The carousel is an absolute-fill background; this block's content
          sets the hero height. box-none lets swipes on uncovered photo areas
          reach the carousel. */}
      <View className="overflow-hidden">
        <HeroCarousel />
        <View pointerEvents="box-none" className="pb-6" style={{ paddingTop: insets.top + 8 }}>
          <View pointerEvents="box-none" className="flex-row items-center gap-2 px-4 pb-2">
            <View pointerEvents="none">
              <Text className="text-subtitle font-bold text-brand">{tBrand("name")}</Text>
            </View>
            <View pointerEvents="none" className="flex-1" />
            <Pressable
              onPress={() => void Linking.openURL(`${WEB_URL}/${locale}/auth/sign-up`)}
              className="rounded-full border border-brand bg-canvas px-3 py-1.5"
            >
              <Text className="text-caption font-semibold text-brand">
                {tHome("becomeProvider")}
              </Text>
            </Pressable>
            <Link href="/account" asChild>
              <Pressable className="h-9 w-9 items-center justify-center rounded-full bg-brand-soft">
                <UserRound size={20} color={colors.brand} />
              </Pressable>
            </Link>
            <Link href="/directory" asChild>
              <Pressable className="h-9 w-9 items-center justify-center rounded-full bg-canvas/80">
                <Menu size={22} color={colors.foreground} />
              </Pressable>
            </Link>
          </View>

          <View pointerEvents="box-none" className="flex-row items-center gap-3 px-4 pb-1">
            <LanguageChip
              active={locale === "en"}
              label={tHome("langEn")}
              localeCode="en"
              onSelect={setLocale}
            />
            <View className="h-3 w-px bg-line" />
            <LanguageChip
              active={locale === "ar"}
              label={tHome("langAr")}
              localeCode="ar"
              onSelect={setLocale}
            />
            <View className="h-3 w-px bg-line" />
            <LanguageChip
              active={locale === "ckb"}
              label={tHome("langCkb")}
              localeCode="ckb"
              onSelect={setLocale}
            />
            <View pointerEvents="none" className="flex-1" />
            <View pointerEvents="none" className="rounded-full bg-canvas px-2.5 py-1">
              <Text className="text-caption font-medium text-brand">{tFeed("promoted")}</Text>
            </View>
          </View>

          {/* pointerEvents "none" on non-interactive overlay pieces: on iOS a
              stretched Text/View hit-tests to itself and blocks carousel
              swipes behind it (box-none only helps for genuinely empty area). */}
          <View pointerEvents="none">
            <Text className="px-4 pt-4 text-title font-bold text-ink">
              {tHome.rich("headline", {
                highlight: (chunks) => <Text className="text-brand">{chunks}</Text>,
              })}
            </Text>
          </View>

          <View pointerEvents="box-none" className="gap-2 px-4 pt-4">
            <Link href="/search" asChild>
              <Pressable className="flex-row items-center gap-2 rounded-lg border border-line bg-surface px-3 py-3">
                <Search size={18} color={colors.muted} />
                <Text numberOfLines={1} className="flex-1 text-body text-neutral-500">
                  {tHero("searchPlaceholder")}
                </Text>
              </Pressable>
            </Link>
            <View className="flex-row gap-2">
              <View className="flex-1 flex-row items-center justify-between rounded-lg border border-line bg-surface px-3 py-3">
                <Text className="text-body text-neutral-500">{tCountry("label")}</Text>
                <ChevronDown size={16} color={colors.muted} />
              </View>
              <View className="flex-1 flex-row items-center justify-between rounded-lg border border-line bg-surface px-3 py-3">
                <Text className="text-body text-neutral-500">{tDirectory("city")}</Text>
                <ChevronDown size={16} color={colors.muted} />
              </View>
            </View>
          </View>
        </View>
      </View>

      <View className="px-4 pt-6">
        <Text className="mb-3 text-heading font-bold text-ink">{tCategories("heading")}</Text>
        {/* gap-1.5 keeps four columns down to 320pt screens (gap-2 wraps to 3+1) */}
        <View className="flex-row flex-wrap gap-1.5">
          {/* Doctors is the reserved ADR-0055 tile id, not a category row —
              listCategories can never return it, so it renders statically
              first, mirroring the directory landing's hardcoded entry. */}
          <Link href="/directory/doctors" asChild>
            <Pressable className="aspect-square w-[23%] overflow-hidden rounded-lg bg-neutral-100">
              <Image
                source={{ uri: DOCTORS_TILE_IMAGE }}
                className="h-full w-full"
                resizeMode="cover"
              />
              <View className="absolute inset-x-0 bottom-0 h-3/5">
                <Scrim direction="to-top" color="#000000" maxOpacity={0.75} />
              </View>
              <Text
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
                className="absolute inset-x-0 bottom-0 p-1.5 text-center text-[10px] font-semibold text-white"
              >
                {tTiles("doctors")}
              </Text>
            </Pressable>
          </Link>
          {activeCategories.map((category) => (
            <Link key={category.slug} href={`/directory/${category.slug}`} asChild>
              <Pressable className="aspect-square w-[23%] overflow-hidden rounded-lg bg-neutral-100">
                <Image
                  source={{ uri: CATEGORY_TILE_IMAGES[category.slug] ?? CATEGORY_TILE_FALLBACK }}
                  className="h-full w-full"
                  resizeMode="cover"
                />
                <View className="absolute inset-x-0 bottom-0 h-3/5">
                  <Scrim direction="to-top" color="#000000" maxOpacity={0.75} />
                </View>
                {/* 10px: the longest single word in all 11 names must fit one
                    tile line whole, or RN character-wraps it mid-word at any
                    numberOfLines; typeScale has no token this small. */}
                <Text
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                  className="absolute inset-x-0 bottom-0 p-1.5 text-center text-[10px] font-semibold text-white"
                >
                  {pickText(category.name, locale)}
                </Text>
              </Pressable>
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

function LanguageChip({
  active,
  label,
  localeCode,
  onSelect,
}: {
  active: boolean;
  label: string;
  localeCode: Locale;
  onSelect: (locale: Locale) => void;
}) {
  return (
    <Pressable onPress={() => onSelect(localeCode)} className="py-1">
      <Text
        className={
          active ? "text-small font-bold text-brand" : "text-small font-medium text-neutral-500"
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}
