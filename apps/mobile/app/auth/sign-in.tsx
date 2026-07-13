import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Link, Stack, useRouter } from "expo-router";
import { useTranslations } from "use-intl";
import { normalizePhone } from "@mesomed/contracts/phone";
import { authClient } from "../../lib/auth-client";

const FIELD = "h-11 w-full rounded-md border border-line bg-canvas px-3 text-body text-ink";

/**
 * Patient sign-in (MM-DEC rev02 §4): phone + password, no OTP on normal
 * login. This app is patient-facing (Phase 9a) — providers sign in on the
 * web dashboards, so there is no provider tab here, unlike
 * apps/web/app/[locale]/auth/sign-in/sign-in-form.tsx.
 */
export default function SignInScreen() {
  const t = useTranslations("web.auth");
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<"credentials" | "phone" | null>(null);

  async function submit() {
    setFailed(null);
    const normalized = normalizePhone(phone);
    if (!normalized) {
      setFailed("phone");
      return;
    }
    setPending(true);
    const result = await authClient.signIn.phoneNumber({ phoneNumber: normalized, password });
    setPending(false);
    if (result.error) {
      setFailed("credentials");
      return;
    }
    router.replace("/account");
  }

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-4 pb-10">
      <Stack.Screen options={{ title: t("signInTitle") }} />
      <Text className="text-title font-bold text-ink">{t("signInTitle")}</Text>

      <View className="mt-6 gap-4">
        <View className="gap-1">
          <Text className="text-small font-medium text-neutral-600">{t("phone")}</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="+964…"
            autoCapitalize="none"
            className={FIELD}
            style={{ writingDirection: "ltr" }}
          />
        </View>
        <View className="gap-1">
          <Text className="text-small font-medium text-neutral-600">{t("password")}</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            className={FIELD}
          />
        </View>

        {failed && (
          <Text className="rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger">
            {failed === "phone" ? t("invalidPhone") : t("signInFailed")}
          </Text>
        )}

        <Pressable
          onPress={() => void submit()}
          disabled={pending}
          className="rounded-md bg-brand px-6 py-3 disabled:opacity-50"
        >
          <Text className="text-center text-body font-semibold text-white">{t("signIn")}</Text>
        </Pressable>
      </View>

      <View className="mt-6 flex-row justify-center gap-1">
        <Text className="text-small text-neutral-500">{t("noAccount")}</Text>
        <Link href="/auth/sign-up" className="text-small font-medium text-brand">
          {t("signUp")}
        </Link>
      </View>
    </ScrollView>
  );
}
