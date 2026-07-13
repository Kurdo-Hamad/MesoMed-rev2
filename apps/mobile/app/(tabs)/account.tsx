import { Pressable, ScrollView, Text, View } from "react-native";
import { UserRound } from "lucide-react-native";
import { Link } from "expo-router";
import { useTranslations } from "use-intl";
import { colors } from "@mesomed/ui-tokens";
import { authClient } from "../../lib/auth-client";

/**
 * Account tab: session surface for MM-DEC rev02 §4 — the persisted session
 * restores on relaunch (Better Auth Expo plugin + secure store, proven in
 * test/auth-persistence.test.ts), the user stays signed in until they sign
 * out here. The patient dashboard content itself lands in Slice 5; this
 * screen is the auth anchor (sign-in/sign-up entry when signed out,
 * identity + sign-out when signed in).
 */
export default function AccountScreen() {
  const t = useTranslations("mobile.account");
  const tAuth = useTranslations("web.auth");
  const session = authClient.useSession();

  if (session.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <View className="h-24 w-64 rounded-lg bg-neutral-100" />
      </View>
    );
  }

  if (!session.data) {
    return (
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-4 pb-10">
        <Text className="text-title font-bold text-ink">{t("title")}</Text>
        <Text className="mt-2 text-body text-neutral-600">{t("signedOutBody")}</Text>
        <View className="mt-6 gap-3">
          <Link href="/auth/sign-in" asChild>
            <Pressable className="rounded-md bg-brand px-6 py-3">
              <Text className="text-center text-body font-semibold text-white">
                {tAuth("signIn")}
              </Text>
            </Pressable>
          </Link>
          <Link href="/auth/sign-up" asChild>
            <Pressable className="rounded-md border border-brand bg-brand-soft px-6 py-3">
              <Text className="text-center text-body font-semibold text-brand">
                {tAuth("signUp")}
              </Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>
    );
  }

  const user = session.data.user;
  const phoneNumber = (user as { phoneNumber?: string | null }).phoneNumber ?? null;

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-4 pb-10">
      <Text className="text-title font-bold text-ink">{t("title")}</Text>
      <View className="mt-6 flex-row items-center gap-4 rounded-lg border border-line bg-surface p-5">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-brand-soft">
          <UserRound size={28} color={colors.brand} />
        </View>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-subtitle font-semibold text-ink">
            {user.name}
          </Text>
          {phoneNumber && (
            <Text className="text-small text-neutral-500" style={{ writingDirection: "ltr" }}>
              {phoneNumber}
            </Text>
          )}
        </View>
      </View>

      <Pressable
        onPress={() => void authClient.signOut()}
        className="mt-6 self-start rounded-md border border-line bg-canvas px-6 py-2.5"
      >
        <Text className="text-small font-medium text-ink">{tAuth("signOut")}</Text>
      </Pressable>
    </ScrollView>
  );
}
