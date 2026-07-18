import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useTranslations } from "use-intl";
import { normalizePhone } from "@mesomed/contracts/phone";
import { authClient } from "../../lib/auth-client";

const FIELD = "h-11 w-full rounded-md border border-line bg-canvas px-3 text-body text-ink";

type Step = "request" | "otp" | "done";
type RecoveryError = "phone" | "rateLimited" | "failed";

/**
 * Patient password recovery (MM-DEC rev02 §5, MM-QA-004 F-01): phone →
 * WhatsApp/SMS OTP → new password. This app is patient-facing, so there is
 * no provider flow here — providers recover on the web, mirroring
 * apps/web/app/[locale]/auth/forgot-password/. Failures classify on HTTP
 * status only, never message text (convention #11).
 */
export default function ForgotPasswordScreen() {
  const t = useTranslations("web.auth");
  const router = useRouter();
  const [step, setStep] = useState<Step>("request");
  const [phone, setPhone] = useState("");
  const [normalized, setNormalized] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<RecoveryError | null>(null);

  async function requestCode() {
    setError(null);
    const e164 = normalizePhone(phone);
    if (!e164) {
      setError("phone");
      return;
    }
    setNormalized(e164);
    setPending(true);
    const result = await authClient.phoneNumber.requestPasswordReset({ phoneNumber: e164 });
    setPending(false);
    if (result.error) {
      setError(result.error.status === 429 ? "rateLimited" : "failed");
      return;
    }
    setStep("otp");
  }

  async function reset() {
    setError(null);
    setPending(true);
    const result = await authClient.phoneNumber.resetPassword({
      otp: code.trim(),
      phoneNumber: normalized,
      newPassword,
    });
    setPending(false);
    if (result.error) {
      setError(result.error.status === 429 ? "rateLimited" : "failed");
      return;
    }
    setStep("done");
  }

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-4 pb-10">
      <Stack.Screen options={{ title: t("forgotPasswordTitle") }} />
      <Text className="text-title font-bold text-ink">{t("forgotPasswordTitle")}</Text>

      {step === "done" ? (
        <View className="mt-8 items-center gap-5">
          <Text className="text-center text-body font-medium text-ink">{t("resetSuccess")}</Text>
          <Pressable
            onPress={() => router.replace("/auth/sign-in")}
            className="rounded-md bg-brand px-6 py-3"
          >
            <Text className="text-center text-body font-semibold text-white">{t("signIn")}</Text>
          </Pressable>
        </View>
      ) : step === "otp" ? (
        <View className="mt-6 gap-4">
          <Text className="text-small text-neutral-600">
            {t("recoveryCodeSent", { phone: normalized })}
          </Text>
          <View className="gap-1">
            <Text className="text-small font-medium text-neutral-600">{t("recoveryCode")}</Text>
            <TextInput
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              className={`${FIELD} text-center`}
              style={{ writingDirection: "ltr" }}
            />
          </View>
          <View className="gap-1">
            <Text className="text-small font-medium text-neutral-600">{t("newPassword")}</Text>
            <TextInput
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              className={FIELD}
            />
          </View>

          {error && (
            <Text className="rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger">
              {error === "rateLimited" ? t("recoveryRateLimited") : t("resetFailed")}
            </Text>
          )}

          <Pressable
            onPress={() => void reset()}
            disabled={pending}
            className="rounded-md bg-brand px-6 py-3 disabled:opacity-50"
          >
            <Text className="text-center text-body font-semibold text-white">
              {t("resetPassword")}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View className="mt-6 gap-4">
          <View className="gap-1">
            <Text className="text-small font-medium text-neutral-600">{t("phone")}</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoCapitalize="none"
              className={FIELD}
              style={{ writingDirection: "ltr" }}
            />
            <Text className="text-caption text-neutral-500">{t("phoneHint")}</Text>
          </View>

          {error && (
            <Text className="rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger">
              {error === "phone"
                ? t("invalidPhone")
                : error === "rateLimited"
                  ? t("recoveryRateLimited")
                  : t("resetFailed")}
            </Text>
          )}

          <Pressable
            onPress={() => void requestCode()}
            disabled={pending}
            className="rounded-md bg-brand px-6 py-3 disabled:opacity-50"
          >
            <Text className="text-center text-body font-semibold text-white">
              {t("recoverySendCode")}
            </Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}
