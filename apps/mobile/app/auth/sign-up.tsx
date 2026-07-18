import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ShieldCheck } from "lucide-react-native";
import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslations } from "use-intl";
import { normalizePhone, placeholderEmailForPhone } from "@mesomed/contracts/phone";
import { semantic } from "@mesomed/ui-tokens";
import { authClient } from "../../lib/auth-client";

type Step = "form" | "otp" | "done";

const FIELD = "h-11 w-full rounded-md border border-line bg-canvas px-3 text-body text-ink";

/**
 * Patient account creation (MM-DEC rev02 §2): phone + password + WhatsApp
 * OTP (SMS fallback server-side). Verifying the OTP proves phone ownership;
 * the server then claims the phone-keyed guest profile in the same
 * transaction — no unverified claim step. Parity with the patient tab of
 * apps/web/app/[locale]/auth/sign-up/sign-up-forms.tsx (this app is
 * patient-facing; provider signup stays on the web). The booking
 * confirmation's account offer links here with ?phone= prefilled.
 */
export default function SignUpScreen() {
  const { phone: phoneParam } = useLocalSearchParams<{ phone?: string }>();
  const t = useTranslations("web.auth");
  const router = useRouter();
  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState(phoneParam ?? "");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"signUp" | "otp" | "phone" | null>(null);
  const [normalized, setNormalized] = useState("");

  async function register() {
    setError(null);
    const e164 = normalizePhone(phone);
    if (!e164) {
      setError("phone");
      return;
    }
    setNormalized(e164);
    setPending(true);
    // The placeholder email is never routable and never mailed — it exists
    // because the credential store requires an email column (identity
    // module design; the contracts helper keeps the format canonical).
    const signUp = await authClient.signUp.email({
      name: name.trim(),
      email: placeholderEmailForPhone(e164),
      password,
      phoneNumber: e164,
    } as Parameters<typeof authClient.signUp.email>[0]);
    if (signUp.error) {
      setPending(false);
      setError("signUp");
      return;
    }
    const otp = await authClient.phoneNumber.sendOtp({ phoneNumber: e164 });
    setPending(false);
    if (otp.error) {
      setError("otp");
      return;
    }
    setStep("otp");
  }

  async function verify() {
    setPending(true);
    setError(null);
    const result = await authClient.phoneNumber.verify({
      phoneNumber: normalized,
      code: code.trim(),
    });
    setPending(false);
    if (result.error) {
      setError("otp");
      return;
    }
    setStep("done");
  }

  if (step === "done") {
    return (
      <View className="flex-1 items-center justify-center bg-canvas px-8">
        <Stack.Screen options={{ title: t("signUpTitle") }} />
        <View className="h-14 w-14 items-center justify-center rounded-full bg-success-soft">
          <ShieldCheck size={28} color={semantic.success} />
        </View>
        <Text className="mt-4 text-body font-medium text-ink">{t("verified")}</Text>
        <Pressable
          onPress={() => router.replace("/account")}
          className="mt-5 rounded-md bg-brand px-6 py-2.5"
        >
          <Text className="text-body font-semibold text-white">{t("goToDashboard")}</Text>
        </Pressable>
      </View>
    );
  }

  if (step === "otp") {
    return (
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-4 pb-10">
        <Stack.Screen options={{ title: t("otpTitle") }} />
        <Text className="text-title font-bold text-ink">{t("otpTitle")}</Text>
        <Text className="mt-2 text-small text-neutral-600">
          {t("otpSent", { phone: normalized })}
        </Text>
        <View className="mt-4 gap-4">
          <View className="gap-1">
            <Text className="text-small font-medium text-neutral-600">{t("otpCode")}</Text>
            <TextInput
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              className={`${FIELD} text-center`}
              style={{ writingDirection: "ltr", letterSpacing: 8 }}
            />
          </View>
          {error && (
            <Text className="rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger">
              {t("otpFailed")}
            </Text>
          )}
          <Pressable
            onPress={() => void verify()}
            disabled={pending}
            className="rounded-md bg-brand px-6 py-3 disabled:opacity-50"
          >
            <Text className="text-center text-body font-semibold text-white">{t("otpVerify")}</Text>
          </Pressable>
          <Pressable
            disabled={pending}
            onPress={() => void authClient.phoneNumber.sendOtp({ phoneNumber: normalized })}
          >
            <Text className="text-center text-small font-medium text-brand">{t("otpResend")}</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-4 pb-10">
      <Stack.Screen options={{ title: t("signUpTitle") }} />
      <Text className="text-title font-bold text-ink">{t("signUpTitle")}</Text>

      <View className="mt-6 gap-4">
        <View className="gap-1">
          <Text className="text-small font-medium text-neutral-600">{t("fullName")}</Text>
          <TextInput value={name} onChangeText={setName} className={FIELD} />
        </View>
        <View className="gap-1">
          <Text className="text-small font-medium text-neutral-600">{t("phone")}</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder={t("phoneHint")}
            autoCapitalize="none"
            className={FIELD}
            style={{ writingDirection: "ltr" }}
          />
          <Text className="text-caption text-neutral-500">{t("phoneHint")}</Text>
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

        {error && (
          <Text className="rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger">
            {error === "phone"
              ? t("invalidPhone")
              : error === "signUp"
                ? t("signUpFailed")
                : t("otpFailed")}
          </Text>
        )}

        <Pressable
          onPress={() => void register()}
          disabled={pending}
          className="rounded-md bg-brand px-6 py-3 disabled:opacity-50"
        >
          <Text className="text-center text-body font-semibold text-white">{t("signUp")}</Text>
        </Pressable>
      </View>

      <View className="mt-6 flex-row justify-center gap-1">
        <Text className="text-small text-neutral-500">{t("haveAccount")}</Text>
        <Link href="/auth/sign-in" className="text-small font-medium text-brand">
          {t("signIn")}
        </Link>
      </View>
    </ScrollView>
  );
}
