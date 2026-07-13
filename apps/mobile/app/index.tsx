import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { trpc } from "../lib/trpc";

export default function HomeScreen() {
  const health = trpc.health.check.useQuery();
  // Every user-facing string comes from the catalogs (MM-PLAN-001 §3.10).
  const t = useTranslations("hello");

  return (
    <View className="flex-1 items-center justify-center gap-2 bg-canvas">
      <Text className="text-title font-semibold text-ink">{t("title")}</Text>
      <Text className="text-body text-neutral-500">
        {health.isLoading ? t("checking") : health.data ? t("subtitle") : t("unreachable")}
      </Text>
    </View>
  );
}
