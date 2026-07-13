import { Text, View } from "react-native";
import { useTranslations } from "use-intl";

/** Full-screen state for COUNTRY_COMING_SOON (MM-PLAN-001 §3.9) — the
 * requesting country isn't gated active yet. No dismiss; nothing behind
 * it is bookable. */
export function ComingSoonScreen() {
  const t = useTranslations("mobile.comingSoon");

  return (
    <View className="flex-1 items-center justify-center gap-3 bg-canvas px-8">
      <Text className="text-title font-semibold text-ink">{t("title")}</Text>
      <Text className="text-center text-body text-ink">{t("body")}</Text>
    </View>
  );
}
