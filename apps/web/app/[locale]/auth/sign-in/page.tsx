import { getTranslations } from "next-intl/server";
import { SignInForm } from "./sign-in-form";

/**
 * The LCP heading is server HTML; the tabbed form hydrates underneath
 * (§3.8 — headings must not wait on the hydration repaint).
 */
export default async function SignInPage() {
  const t = await getTranslations("web.auth");
  return (
    <main className="mx-auto w-full max-w-md px-4 py-14">
      <h1 className="text-center text-title font-bold text-ink">{t("signInTitle")}</h1>
      <SignInForm />
    </main>
  );
}
