import { Text, View } from "react-native";
import { useTranslations } from "use-intl";

/** Blocking screen for ADR-0013's UPGRADE_REQUIRED gate — no dismiss, no
 * navigation underneath; the app is unusable below the configured minimum
 * version. */
export function UpgradeRequiredScreen() {
  const t = useTranslations("mobile.upgradeRequired");

  return (
    <View className="flex-1 items-center justify-center gap-3 bg-canvas px-8">
      <Text className="text-title font-semibold text-ink">{t("title")}</Text>
      <Text className="text-center text-body text-ink">{t("body")}</Text>
    </View>
  );
}
