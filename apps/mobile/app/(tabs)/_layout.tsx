import { House, Search, UserRound } from "lucide-react-native";
import { Tabs } from "expo-router";
import { colors } from "@mesomed/ui-tokens";
import { useTranslations } from "use-intl";

export default function TabsLayout() {
  const t = useTranslations("web.nav");
  const tAccount = useTranslations("mobile.account");

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("home"),
          tabBarIcon: ({ color, size }) => <House color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: t("search"),
          tabBarIcon: ({ color, size }) => <Search color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: tAccount("title"),
          tabBarIcon: ({ color, size }) => <UserRound color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
