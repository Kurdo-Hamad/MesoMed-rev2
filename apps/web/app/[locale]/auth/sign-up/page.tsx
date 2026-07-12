"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { normalizePhone, placeholderEmailForPhone } from "@mesomed/contracts/phone";
import { Link, useRouter } from "../../../../i18n/navigation";
import { authClient } from "../../../../lib/auth-client";

type Tab = "patient" | "provider";
type PatientStep = "form" | "otp" | "done";

export default function SignUpPage() {
  // useSearchParams requires a Suspense boundary on statically rendered pages.
  return (
    <Suspense fallback={null}>
      <SignUpInner />
    </Suspense>
  );
}

/**
 * Account creation (MM-DEC rev02 §2/§3):
 * - Patient: phone + password + WhatsApp OTP (SMS fallback server-side).
 *   Verifying the OTP proves phone ownership; the server then claims the
 *   phone-keyed profile in the same transaction — no unverified claim step.
 * - Provider: email (verified) + password + phone; account lands `pending`
 *   until an admin approves (§3 verification gate).
 */
function SignUpInner() {
  const t = useTranslations("web.auth");
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>("patient");

  const tabClass = (active: boolean) =>
    active
      ? "flex-1 rounded-md bg-brand px-4 py-2 text-small font-semibold text-white"
      : "flex-1 rounded-md border border-line bg-canvas px-4 py-2 text-small font-medium text-neutral-600 transition-colors duration-fast hover:border-brand";

  return (
    <main className="mx-auto w-full max-w-md px-4 py-14">
      <h1 className="text-center text-title font-bold text-ink">{t("signUpTitle")}</h1>
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

      {tab === "patient" ? (
        <PatientSignUp initialPhone={searchParams.get("phone") ?? ""} />
      ) : (
        <ProviderSignUp />
      )}

      <p className="mt-6 text-center text-small text-neutral-500">
        {t("haveAccount")}{" "}
        <Link href="/auth/sign-in" className="font-medium text-brand hover:underline">
          {t("signIn")}
        </Link>
      </p>
    </main>
  );
}

const FIELD =
  "h-11 w-full rounded-md border border-line bg-canvas px-3 text-body text-ink shadow-card outline-none transition-shadow duration-fast focus:border-brand";

function PatientSignUp({ initialPhone }: { initialPhone: string }) {
  const t = useTranslations("web.auth");
  const router = useRouter();
  const [step, setStep] = useState<PatientStep>("form");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState(initialPhone);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"signUp" | "otp" | "phone" | null>(null);
  const [normalized, setNormalized] = useState("");

  async function register(event: FormEvent) {
    event.preventDefault();
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

  async function verify(event: FormEvent) {
    event.preventDefault();
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
      <div className="mt-8 flex flex-col items-center text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success-soft">
          <ShieldCheck className="h-7 w-7 text-success" aria-hidden="true" />
        </span>
        <p className="mt-4 text-body font-medium text-ink">{t("verified")}</p>
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="mt-5 rounded-md bg-brand px-6 py-2.5 text-body font-semibold text-white transition-colors duration-fast hover:bg-brand-strong"
        >
          {t("goToDashboard")}
        </button>
      </div>
    );
  }

  if (step === "otp") {
    return (
      <form onSubmit={verify} className="mt-6 flex flex-col gap-4">
        <h2 className="text-heading font-bold text-ink">{t("otpTitle")}</h2>
        <p className="text-small text-neutral-600">{t("otpSent", { phone: normalized })}</p>
        <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
          {t("otpCode")}
          <input
            required
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className={`${FIELD} text-center tracking-[0.5em]`}
          />
        </label>
        {error && (
          <p className="rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger">
            {t("otpFailed")}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-6 py-3 text-body font-semibold text-white transition-colors duration-fast hover:bg-brand-strong disabled:opacity-50"
        >
          {t("otpVerify")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => void authClient.phoneNumber.sendOtp({ phoneNumber: normalized })}
          className="text-small font-medium text-brand hover:underline disabled:opacity-50"
        >
          {t("otpResend")}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={register} className="mt-6 flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
        {t("fullName")}
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
        {t("phone")}
        <input
          required
          type="tel"
          dir="ltr"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="+964…"
          className={FIELD}
        />
        <span className="font-normal text-caption text-neutral-500">{t("phoneHint")}</span>
      </label>
      <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
        {t("password")}
        <input
          required
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={FIELD}
        />
      </label>
      {error && (
        <p className="rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger">
          {error === "phone"
            ? t("invalidPhone")
            : error === "signUp"
              ? t("signUpFailed")
              : t("otpFailed")}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-brand px-6 py-3 text-body font-semibold text-white transition-colors duration-fast hover:bg-brand-strong disabled:opacity-50"
      >
        {t("signUp")}
      </button>
    </form>
  );
}

function ProviderSignUp() {
  const t = useTranslations("web.auth");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<"signUp" | "phone" | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function register(event: FormEvent) {
    event.preventDefault();
    setFailed(null);
    const e164 = normalizePhone(phone);
    if (!e164) {
      setFailed("phone");
      return;
    }
    setPending(true);
    const result = await authClient.signUp.email({
      name: name.trim(),
      email: email.trim(),
      password,
      phoneNumber: e164,
    } as Parameters<typeof authClient.signUp.email>[0]);
    setPending(false);
    if (result.error) {
      setFailed("signUp");
      return;
    }
    setSentTo(email.trim());
  }

  if (sentTo) {
    return (
      <p className="mt-8 rounded-md bg-info-soft px-4 py-4 text-body text-neutral-700">
        {t("providerEmailSent", { email: sentTo })}
      </p>
    );
  }

  return (
    <form onSubmit={register} className="mt-6 flex flex-col gap-4">
      <p className="rounded-md bg-info-soft px-4 py-3 text-small text-neutral-700">
        {t("providerSignupNote")}
      </p>
      <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
        {t("fullName")}
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
        {t("email")}
        <input
          required
          type="email"
          dir="ltr"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
        {t("phone")}
        <input
          required
          type="tel"
          dir="ltr"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="+964…"
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
        {t("password")}
        <input
          required
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={FIELD}
        />
      </label>
      {failed && (
        <p className="rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger">
          {failed === "phone" ? t("invalidPhone") : t("signUpFailed")}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-brand px-6 py-3 text-body font-semibold text-white transition-colors duration-fast hover:bg-brand-strong disabled:opacity-50"
      >
        {t("signUp")}
      </button>
    </form>
  );
}
