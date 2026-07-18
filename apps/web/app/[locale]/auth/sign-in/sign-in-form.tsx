"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { normalizePhone } from "@mesomed/contracts/phone";
import { Link, useRouter } from "../../../../i18n/navigation";
import { authClient } from "../../../../lib/auth-client";

type Tab = "patient" | "provider";

/**
 * Sign-in (MM-DEC rev02 §4): patients phone+password, providers
 * email+password. No OTP on normal login for either.
 */
export function SignInForm() {
  const t = useTranslations("web.auth");
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("patient");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<"credentials" | "phone" | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(null);
    let result;
    if (tab === "patient") {
      const normalized = normalizePhone(identifier);
      if (!normalized) {
        setFailed("phone");
        return;
      }
      setPending(true);
      result = await authClient.signIn.phoneNumber({ phoneNumber: normalized, password });
    } else {
      setPending(true);
      result = await authClient.signIn.email({ email: identifier.trim(), password });
    }
    setPending(false);
    if (result.error) {
      setFailed("credentials");
      return;
    }
    router.push("/dashboard");
  }

  const tabClass = (active: boolean) =>
    active
      ? "flex-1 rounded-md bg-brand px-4 py-2 text-small font-semibold text-white"
      : "flex-1 rounded-md border border-line bg-canvas px-4 py-2 text-small font-medium text-neutral-600 transition-colors duration-fast hover:border-brand";

  const field =
    "h-11 w-full rounded-md border border-line bg-canvas px-3 text-body text-ink shadow-card outline-none transition-shadow duration-fast focus:border-brand";

  return (
    <>
      <div className="mt-6 flex gap-2" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "patient"}
          onClick={() => setTab("patient")}
          className={tabClass(tab === "patient")}
        >
          {t("patientTab")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "provider"}
          onClick={() => setTab("provider")}
          className={tabClass(tab === "provider")}
        >
          {t("providerTab")}
        </button>
      </div>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
          {tab === "patient" ? t("phone") : t("email")}
          <input
            required
            dir="ltr"
            type={tab === "patient" ? "tel" : "email"}
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder={tab === "patient" ? "+964…" : undefined}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
          {t("password")}
          <input
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={field}
          />
        </label>

        <Link
          href="/auth/forgot-password"
          className="self-end text-small font-medium text-brand hover:underline"
        >
          {t("forgotPassword")}
        </Link>

        {failed && (
          <p className="rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger">
            {failed === "phone" ? t("invalidPhone") : t("signInFailed")}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-6 py-3 text-body font-semibold text-white transition-colors duration-fast hover:bg-brand-strong disabled:opacity-50"
        >
          {t("signIn")}
        </button>
      </form>

      <p className="mt-6 text-center text-small text-neutral-500">
        {t("noAccount")}{" "}
        <Link href="/auth/sign-up" className="font-medium text-brand hover:underline">
          {t("signUp")}
        </Link>
      </p>
    </>
  );
}
