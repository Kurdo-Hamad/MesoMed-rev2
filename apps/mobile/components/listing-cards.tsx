import { Image, Pressable, Text, View } from "react-native";
import { Building2, UserRound } from "lucide-react-native";
import { Link } from "expo-router";
import { useTranslations } from "use-intl";
import { colors } from "@mesomed/ui-tokens";
import type { Locale } from "@mesomed/i18n";
import { useLocale } from "../lib/locale";
import { pickOptionalText, pickText, type LocalizedText } from "../lib/localized";
import { mediaUrl } from "../lib/media";

export interface FacilityCardData {
  slug: string;
  name: LocalizedText;
  cityName: LocalizedText;
  featured: boolean;
  photoPath: string | null;
}

export interface DoctorCardData {
  slug: string;
  name: LocalizedText;
  specialtyName: LocalizedText | null;
  cityName: LocalizedText | null;
  photoUrl: string | null;
}

function Badge({ tone, children }: { tone: "featured" | "promoted"; children: string }) {
  const className = tone === "featured" ? "bg-featured-soft" : "bg-neutral-100 border border-line";
  const textClassName = tone === "featured" ? "text-featured" : "text-neutral-600";
  return (
    <View
      className={`absolute top-2 rounded-sm px-2 py-0.5 ${className}`}
      style={{ insetInlineStart: 8 }}
    >
      <Text className={`text-caption font-semibold ${textClassName}`}>{children}</Text>
    </View>
  );
}

function CardImage({ src, fallback }: { src: string | null; fallback: "facility" | "doctor" }) {
  if (src) {
    return <Image source={{ uri: mediaUrl(src) }} className="h-full w-full" resizeMode="cover" />;
  }
  const Icon = fallback === "facility" ? Building2 : UserRound;
  return (
    <View className="h-full w-full items-center justify-center bg-brand-soft">
      <Icon size={40} color={colors.brand} />
    </View>
  );
}

function useCardLabel(locale: Locale) {
  const t = useTranslations("web.home.feed");
  return { locale, featured: t("featured"), promoted: t("promoted") };
}

/** Facility card: image, name, city, featured/sponsored badge. Mirrors
 * apps/web/components/listing-cards.tsx's FacilityCard. */
export function FacilityCard({
  facility,
  promoted,
}: {
  facility: FacilityCardData;
  promoted?: boolean;
}) {
  const { locale } = useLocale();
  const t = useCardLabel(locale);

  return (
    <Link href={`/facility/${facility.slug}`} asChild>
      <Pressable className="overflow-hidden rounded-lg border border-line bg-canvas shadow-card">
        <View className="aspect-[4/3]">
          <CardImage src={facility.photoPath} fallback="facility" />
          {promoted ? (
            <Badge tone="promoted">{t.promoted}</Badge>
          ) : facility.featured ? (
            <Badge tone="featured">{t.featured}</Badge>
          ) : null}
        </View>
        <View className="gap-0.5 p-3">
          <Text numberOfLines={1} className="text-body font-semibold text-ink">
            {pickText(facility.name, locale)}
          </Text>
          <Text numberOfLines={1} className="text-small text-neutral-500">
            {pickText(facility.cityName, locale)}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}

/** Doctor card: photo, name, specialty, city. Mirrors
 * apps/web/components/listing-cards.tsx's DoctorCard. */
export function DoctorCard({ doctor, promoted }: { doctor: DoctorCardData; promoted?: boolean }) {
  const { locale } = useLocale();
  const t = useCardLabel(locale);
  const specialty = pickOptionalText(doctor.specialtyName, locale);
  const city = pickOptionalText(doctor.cityName, locale);

  return (
    <Link href={`/doctor/${doctor.slug}`} asChild>
      <Pressable className="overflow-hidden rounded-lg border border-line bg-canvas shadow-card">
        <View className="aspect-[4/3]">
          <CardImage src={doctor.photoUrl} fallback="doctor" />
          {promoted ? <Badge tone="promoted">{t.promoted}</Badge> : null}
        </View>
        <View className="gap-0.5 p-3">
          <Text numberOfLines={1} className="text-body font-semibold text-ink">
            {pickText(doctor.name, locale)}
          </Text>
          <Text numberOfLines={1} className="text-small text-neutral-500">
            {[specialty, city].filter(Boolean).join(" · ")}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}

/** Loading placeholder matching the card footprint. */
export function CardSkeleton() {
  return (
    <View className="overflow-hidden rounded-lg border border-line bg-canvas shadow-card">
      <View className="aspect-[4/3] bg-neutral-100" />
      <View className="gap-0.5 p-3">
        <View className="h-6 w-3/4 rounded-sm bg-neutral-100" />
        <View className="mt-1 h-5 w-1/2 rounded-sm bg-neutral-100" />
      </View>
    </View>
  );
}
