import { Image, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { Building2, Globe, Mail, MapPin, Phone } from "lucide-react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useTranslations } from "use-intl";
import { colors } from "@mesomed/ui-tokens";
import { useLocale } from "../../lib/locale";
import { mediaUrl } from "../../lib/media";
import { pickOptionalText, pickText, type LocalizedText } from "../../lib/localized";
import { trpc } from "../../lib/trpc";

interface SectionRow {
  id: string;
  sectionTypeKey: string;
  sectionTypeLabel: LocalizedText;
  name: LocalizedText;
  imagePath: string | null;
}

function groupSections(sections: SectionRow[]) {
  const groups = new Map<string, { key: string; label: LocalizedText; items: SectionRow[] }>();
  for (const section of sections) {
    const group = groups.get(section.sectionTypeKey) ?? {
      key: section.sectionTypeKey,
      label: section.sectionTypeLabel,
      items: [],
    };
    group.items.push(section);
    groups.set(section.sectionTypeKey, group);
  }
  return [...groups.values()];
}

/** Public facility detail. Parity with
 * apps/web/app/[locale]/facility/[slug]/page.tsx. */
export default function FacilityDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const t = useTranslations("web.facility");
  const { locale } = useLocale();
  const facility = trpc.directory.facilityDetail.useQuery({ slugOrId: slug });

  if (facility.isLoading) {
    return (
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-4">
        <View className="aspect-[3/1] rounded-lg bg-neutral-100" />
      </ScrollView>
    );
  }

  if (!facility.data) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas px-8">
        <Stack.Screen options={{ title: t("notFound") }} />
        <Text className="text-subtitle text-neutral-500">{t("notFound")}</Text>
      </View>
    );
  }

  const data = facility.data;
  const about = pickOptionalText(data.about, locale);
  const whyChooseUs = pickOptionalText(data.whyChooseUs, locale);
  const address = pickOptionalText(data.address, locale);
  const sections = groupSections(data.sections);

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="pb-10">
      <Stack.Screen options={{ title: pickText(data.name, locale) }} />

      {data.media.length > 0 ? (
        <>
          <View className="aspect-[3/1] w-full">
            <Image
              source={{ uri: mediaUrl(data.media[0]!.path) }}
              className="h-full w-full"
              resizeMode="cover"
            />
          </View>
          {data.media.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="mt-2 px-4"
              contentContainerClassName="gap-2"
            >
              {data.media.slice(1).map((item) => (
                <Image
                  key={item.path}
                  source={{ uri: mediaUrl(item.path) }}
                  className="h-20 w-28 rounded-md"
                  resizeMode="cover"
                />
              ))}
            </ScrollView>
          )}
        </>
      ) : (
        <View className="aspect-[3/1] w-full items-center justify-center bg-brand-soft">
          <Building2 size={48} color={colors.brand} />
        </View>
      )}

      <View className="p-4">
        <Text className="text-title font-bold text-ink">{pickText(data.name, locale)}</Text>
        <View className="mt-1 flex-row items-center gap-1.5">
          <MapPin size={16} color={colors.muted} />
          <Text className="text-body text-neutral-500">
            {pickText(data.cityName, locale)} · {pickText(data.categoryName, locale)}
          </Text>
        </View>

        {about && <TextBlock heading={t("about")} body={about} />}
        {whyChooseUs && <TextBlock heading={t("whyChooseUs")} body={whyChooseUs} />}

        {sections.map((group) => (
          <View key={group.key} className="mt-8">
            <Text className="mb-3 text-heading font-bold text-ink">
              {pickText(group.label, locale)}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {group.items.map((section) => (
                <View
                  key={section.id}
                  className="rounded-md border border-line bg-surface px-3 py-2"
                >
                  <Text className="text-small text-ink">{pickText(section.name, locale)}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}

        <View className="mt-8 rounded-lg border border-line bg-surface p-5">
          <Text className="mb-4 text-subtitle font-bold text-ink">{t("contact")}</Text>
          <View className="gap-3">
            {address && <ContactRow icon={MapPin} label={t("address")} value={address} />}
            {data.phone && (
              <ContactRow
                icon={Phone}
                label={t("phone")}
                value={data.phone}
                onPress={() => Linking.openURL(`tel:${data.phone}`)}
              />
            )}
            {data.email && (
              <ContactRow
                icon={Mail}
                label={t("email")}
                value={data.email}
                onPress={() => Linking.openURL(`mailto:${data.email}`)}
              />
            )}
            {data.websiteOrSocial && (
              <ContactRow
                icon={Globe}
                label={t("website")}
                value={data.websiteOrSocial}
                onPress={() => Linking.openURL(data.websiteOrSocial!)}
              />
            )}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function TextBlock({ heading, body }: { heading: string; body: string }) {
  return (
    <View className="mt-8">
      <Text className="mb-3 text-heading font-bold text-ink">{heading}</Text>
      <Text className="text-body leading-6 text-neutral-700">{body}</Text>
    </View>
  );
}

function ContactRow({
  icon: Icon,
  label,
  value,
  onPress,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress}>
      <View className="flex-row items-center gap-2.5">
        <Icon size={16} color={colors.brand} />
        <Text className="text-caption text-neutral-500">{label}</Text>
      </View>
      {/* Phone/email/URL stay LTR inside RTL layouts. */}
      <Text className="ps-6 text-ink" style={{ writingDirection: "ltr" }}>
        {value}
      </Text>
    </Pressable>
  );
}
