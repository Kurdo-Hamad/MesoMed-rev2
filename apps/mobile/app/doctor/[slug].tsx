import { Image, ScrollView, Text, View } from "react-native";
import { MapPin, UserRound } from "lucide-react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useTranslations } from "use-intl";
import { colors } from "@mesomed/ui-tokens";
import { useLocale } from "../../lib/locale";
import { mediaUrl } from "../../lib/media";
import { pickOptionalText, pickText } from "../../lib/localized";
import { trpc } from "../../lib/trpc";

/** Public doctor detail. Parity with
 * apps/web/app/[locale]/doctor/[slug]/page.tsx. */
export default function DoctorDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const t = useTranslations("web.doctor");
  const { locale } = useLocale();
  const doctor = trpc.directory.doctorDetail.useQuery({ slugOrId: slug });

  if (doctor.isLoading) {
    return (
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-4">
        <View className="h-36 w-36 rounded-lg bg-neutral-100" />
      </ScrollView>
    );
  }

  if (!doctor.data) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas px-8">
        <Stack.Screen options={{ title: t("notFound") }} />
        <Text className="text-subtitle text-neutral-500">{t("notFound")}</Text>
      </View>
    );
  }

  const specialty = pickOptionalText(doctor.data.specialtyName, locale);
  const city = pickOptionalText(doctor.data.cityName, locale);
  const bio = pickOptionalText(doctor.data.bio, locale);

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-4 pb-10">
      <Stack.Screen options={{ title: pickText(doctor.data.name, locale) }} />
      <View className="flex-row items-start gap-4">
        <View className="h-32 w-32 shrink-0 overflow-hidden rounded-lg bg-brand-soft">
          {doctor.data.photoUrl ? (
            <Image
              source={{ uri: mediaUrl(doctor.data.photoUrl) }}
              className="h-full w-full"
              resizeMode="cover"
            />
          ) : (
            <View className="h-full w-full items-center justify-center">
              <UserRound size={40} color={colors.brand} />
            </View>
          )}
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-title font-bold text-ink">
            {pickText(doctor.data.name, locale)}
          </Text>
          {specialty && <Text className="text-subtitle text-brand">{specialty}</Text>}
          {city && (
            <View className="flex-row items-center gap-1.5">
              <MapPin size={16} color={colors.muted} />
              <Text className="text-body text-neutral-500">{city}</Text>
            </View>
          )}
          {/* Book button lands in Slice 3 alongside the /book/[slug] route
              itself (MM-DEC §1/§2 guest booking flow). */}
        </View>
      </View>

      {bio && (
        <View className="mt-8">
          <Text className="mb-3 text-heading font-bold text-ink">{t("bio")}</Text>
          <Text className="text-body leading-6 text-neutral-700">{bio}</Text>
        </View>
      )}
    </ScrollView>
  );
}
