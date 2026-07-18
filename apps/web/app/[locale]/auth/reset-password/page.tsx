import { getTranslations } from "next-intl/server";
import { ResetPasswordForm } from "./reset-password-form";

/**
 * The LCP heading is server HTML; the token-gated form hydrates underneath
 * (§3.8 — headings must not wait on the hydration repaint).
 */
export default async function ResetPasswordPage() {
  const t = await getTranslations("web.auth");
  return (
    <main className="mx-auto w-full max-w-md px-4 py-14">
      <h1 className="text-center text-title font-bold text-ink">{t("forgotPasswordTitle")}</h1>
      <ResetPasswordForm />
    </main>
  );
}
