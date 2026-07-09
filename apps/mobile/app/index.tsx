import { StyleSheet, Text, View } from "react-native";
import { locales } from "@mesomed/i18n";
import { colors } from "@mesomed/ui-tokens";
import { trpc } from "../lib/trpc";

export default function HomeScreen() {
  const health = trpc.health.check.useQuery();
  const t = locales.en.hello;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t.title}</Text>
      <Text style={styles.subtitle}>
        {health.isLoading ? "Checking API…" : health.data ? t.subtitle : "API unreachable"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.background,
  },
  title: {
    fontSize: 28,
    fontWeight: "600",
    color: colors.foreground,
  },
  subtitle: {
    fontSize: 16,
    color: colors.muted,
  },
});
