import { useEffect, useRef } from "react";
import { Alert, I18nManager, Linking, Pressable, ScrollView, Text, View } from "react-native";
import {
  BriefcaseMedical,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  HeartPulse,
  Stethoscope,
  UserRound,
} from "lucide-react-native";
import { Link, type Href } from "expo-router";
import { useTranslations } from "use-intl";
import { colors } from "@mesomed/ui-tokens";
import { authClient } from "../../lib/auth-client";
import { useLocale } from "../../lib/locale";
import { devicePlatform, getPushToken } from "../../lib/push";
import { trpc } from "../../lib/trpc";

/**
 * Canonical legal pages live on the web (ADR-0034): the store-required
 * privacy policy URL and terms are one copy, opened in the user's locale.
 */
const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? "https://mesomed.krd";

function LegalLinks() {
  const tLegal = useTranslations("web.legal");
  const { locale } = useLocale();
  return (
    <View className="mt-8 flex-row gap-6 border-t border-line pt-4">
      <Pressable onPress={() => void Linking.openURL(`${WEB_URL}/${locale}/privacy`)}>
        <Text className="text-small text-neutral-500 underline">{tLegal("privacyLink")}</Text>
      </Pressable>
      <Pressable onPress={() => void Linking.openURL(`${WEB_URL}/${locale}/terms`)}>
        <Text className="text-small text-neutral-500 underline">{tLegal("termsLink")}</Text>
      </Pressable>
    </View>
  );
}

/**
 * Account tab: session surface for MM-DEC rev02 §4 — the persisted session
 * restores on relaunch (Better Auth Expo plugin + secure store, proven in
 * test/auth-persistence.test.ts), the user stays signed in until they sign
 * out here. Signed in, it anchors the patient dashboard (appointments,
 * health record, visit history) and registers this device for push
 * (MM-DEC §6: push becomes the primary channel once a token exists).
 */
export default function AccountScreen() {
  const t = useTranslations("mobile.account");
  const tAuth = useTranslations("web.auth");
  const tDash = useTranslations("web.dashboard");
  const session = authClient.useSession();

  // Role-aware clinic entry (Phase 9b): providers see the clinic queue
  // link when the session carries a clinic-side role. The API re-checks
  // every read/action (layer a/b) — this gating is navigation only.
  const me = trpc.identity.me.useQuery(undefined, { enabled: session.data !== null });
  const isClinicSide =
    me.data !== undefined &&
    me.data.roles.some((role) => role === "doctor" || role === "secretary");

  const register = trpc.communication.registerDeviceToken.useMutation();
  const unregister = trpc.communication.unregisterDeviceToken.useMutation();
  const deleteAccount = trpc.identity.deleteAccount.useMutation();
  const registeredRef = useRef(false);

  useEffect(() => {
    // Once per app run, after sign-in: push registration is best-effort —
    // a denied permission or missing push infra just means WhatsApp/SMS
    // stay the delivery channels server-side (MM-DEC §6).
    if (!session.data || registeredRef.current) return;
    registeredRef.current = true;
    void (async () => {
      const platform = devicePlatform();
      const token = await getPushToken();
      if (platform && token) register.mutate({ token, platform });
    })();
    // register is a stable mutation handle; session.data flips on sign-in.
  }, [session.data, register]);

  async function signOut() {
    // A device signing out should stop receiving push here (ADR-0011 F-9);
    // unregister is idempotent and never blocks the sign-out itself.
    const token = await getPushToken();
    if (token) {
      try {
        await unregister.mutateAsync({ token });
      } catch {
        // Session may already be gone — sign-out proceeds regardless.
      }
    }
    registeredRef.current = false;
    await authClient.signOut();
  }

  function confirmDeleteAccount() {
    Alert.alert(t("deleteConfirmTitle"), t("deleteConfirmBody"), [
      { text: t("deleteCancel"), style: "cancel" },
      {
        text: t("deleteConfirmCta"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await deleteAccount.mutateAsync();
              registeredRef.current = false;
              await authClient.signOut();
            } catch {
              Alert.alert(t("deleteFailed"));
            }
          })();
        },
      },
    ]);
  }

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
        <LegalLinks />
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

      <View className="mt-6 gap-3">
        {isClinicSide && (
          <DashboardLink
            href="/clinic"
            icon={<BriefcaseMedical size={22} color={colors.brand} />}
            label={tDash("navClinic")}
          />
        )}
        <DashboardLink
          href="/dashboard/appointments"
          icon={<CalendarDays size={22} color={colors.brand} />}
          label={tDash("navAppointments")}
        />
        <DashboardLink
          href="/dashboard/health"
          icon={<HeartPulse size={22} color={colors.brand} />}
          label={tDash("navHealth")}
        />
        <DashboardLink
          href="/dashboard/encounters"
          icon={<Stethoscope size={22} color={colors.brand} />}
          label={tDash("navEncounters")}
        />
      </View>

      <Pressable
        onPress={() => void signOut()}
        className="mt-6 self-start rounded-md border border-line bg-canvas px-6 py-2.5"
      >
        <Text className="text-small font-medium text-ink">{tAuth("signOut")}</Text>
      </Pressable>

      <Pressable
        onPress={confirmDeleteAccount}
        disabled={deleteAccount.isPending}
        className="mt-10 self-start border-t border-line pt-6"
      >
        <Text className="text-small font-medium text-danger">{t("deleteAccount")}</Text>
      </Pressable>

      <LegalLinks />
    </ScrollView>
  );
}

function DashboardLink({
  href,
  icon,
  label,
}: {
  href: Href;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link href={href} asChild>
      <Pressable className="flex-row items-center gap-4 rounded-lg border border-line bg-canvas p-4 shadow-card">
        <View className="h-10 w-10 items-center justify-center rounded-md bg-brand-soft">
          {icon}
        </View>
        <Text className="flex-1 text-body font-semibold text-ink">{label}</Text>
        {/* Directional affordance, not text: pick the glyph by native
            layout direction (I18nManager flips the row automatically). */}
        {I18nManager.isRTL ? (
          <ChevronLeft size={18} color={colors.muted} />
        ) : (
          <ChevronRight size={18} color={colors.muted} />
        )}
      </Pressable>
    </Link>
  );
}
