"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ShieldCheck } from "lucide-react";
import { normalizePhone } from "@mesomed/contracts/phone";
import { ErrorCode } from "@mesomed/contracts/errors";
import { Link } from "../../../../i18n/navigation";
import { authClient } from "../../../../lib/auth-client";
import { trpc } from "../../../../lib/trpc";

type Tab = "patient" | "provider";
type RecoveryStep = "request" | "otp" | "done";
type RecoveryError = "phone" | "rateLimited" | "failed";

const FIELD =
  "h-11 w-full rounded-md border border-line bg-canvas px-3 text-body text-ink shadow-card outline-none transition-shadow duration-fast focus:border-brand";

// Convention #11: classify on HTTP status / typed appCode only — never on
// message text (MM-QA-004 F-05 precedent, mirrors lib/booking-error.ts).
function classifyAuthError(error: { status: number }): RecoveryError {
  return error.status === 429 ? "rateLimited" : "failed";
}

function classifyTrpcError(error: { data?: { appCode?: string } | null }): RecoveryError {
  return error.data?.appCode === ErrorCode.RATE_LIMITED ? "rateLimited" : "failed";
}

/**
 * Password recovery (MM-DEC rev02 §5, MM-QA-004 F-01):
 * - Patient: phone OTP (WhatsApp → SMS fallback server-side) + new password.
 * - Provider: verified email reset link first; WhatsApp/SMS OTP to the
 *   registered phone as the fallback (§5 order of preference).
 */
export function ForgotPasswordForms() {
  const t = useTranslations("web.auth");
  const [tab, setTab] = useState<Tab>("patient");

  const tabClass = (active: boolean) =>
    active
      ? "flex-1 rounded-md bg-brand px-4 py-2 text-small font-semibold text-white"
      : "flex-1 rounded-md border border-line bg-canvas px-4 py-2 text-small font-medium text-neutral-600 transition-colors duration-fast hover:border-brand";

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

      {tab === "patient" ? <PatientRecovery /> : <ProviderRecovery />}

      <p className="mt-6 text-center text-small text-neutral-500">
        <Link href="/auth/sign-in" className="font-medium text-brand hover:underline">
          {t("backToSignIn")}
        </Link>
      </p>
    </>
  );
}

function RecoveryDone() {
  const t = useTranslations("web.auth");
  return (
    <div className="mt-8 flex flex-col items-center text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success-soft">
        <ShieldCheck className="h-7 w-7 text-success" aria-hidden="true" />
      </span>
      <p className="mt-4 text-body font-medium text-ink">{t("resetSuccess")}</p>
      <Link
        href="/auth/sign-in"
        className="mt-5 rounded-md bg-brand px-6 py-2.5 text-body font-semibold text-white transition-colors duration-fast hover:bg-brand-strong"
      >
        {t("signIn")}
      </Link>
    </div>
  );
}

function RecoveryErrorNote({ error }: { error: RecoveryError }) {
  const t = useTranslations("web.auth");
  return (
    <p className="rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger">
      {error === "phone"
        ? t("invalidPhone")
        : error === "rateLimited"
          ? t("recoveryRateLimited")
          : t("resetFailed")}
    </p>
  );
}

function PatientRecovery() {
  const t = useTranslations("web.auth");
  const [step, setStep] = useState<RecoveryStep>("request");
  const [phone, setPhone] = useState("");
  const [normalized, setNormalized] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<RecoveryError | null>(null);

  async function requestCode(event: FormEvent) {
    event.preventDefault();
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
      setError(classifyAuthError(result.error));
      return;
    }
    setStep("otp");
  }

  async function reset(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const result = await authClient.phoneNumber.resetPassword({
      otp: code.trim(),
      phoneNumber: normalized,
      newPassword,
    });
    setPending(false);
    if (result.error) {
      setError(classifyAuthError(result.error));
      return;
    }
    setStep("done");
  }

  if (step === "done") return <RecoveryDone />;

  if (step === "otp") {
    return (
      <form onSubmit={reset} className="mt-6 flex flex-col gap-4">
        <p className="text-small text-neutral-600">
          {t("recoveryCodeSent", { phone: normalized })}
        </p>
        <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
          {t("recoveryCode")}
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
        <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
          {t("newPassword")}
          <input
            required
            type="password"
            minLength={8}
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className={FIELD}
          />
        </label>
        {error && <RecoveryErrorNote error={error} />}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-6 py-3 text-body font-semibold text-white transition-colors duration-fast hover:bg-brand-strong disabled:opacity-50"
        >
          {t("resetPassword")}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={requestCode} className="mt-6 flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
        {t("phone")}
        <input
          required
          type="tel"
          dir="ltr"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          className={FIELD}
        />
        <span className="font-normal text-caption text-neutral-500">{t("phoneHint")}</span>
      </label>
      {error && <RecoveryErrorNote error={error} />}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-brand px-6 py-3 text-body font-semibold text-white transition-colors duration-fast hover:bg-brand-strong disabled:opacity-50"
      >
        {t("recoverySendCode")}
      </button>
    </form>
  );
}

function ProviderRecovery() {
  const t = useTranslations("web.auth");
  const locale = useLocale();
  const [byPhone, setByPhone] = useState(false);
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<RecoveryError | null>(null);

  async function requestLink(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const result = await authClient.requestPasswordReset({
      email: email.trim(),
      redirectTo: `/${locale}/auth/reset-password`,
    });
    setPending(false);
    if (result.error) {
      setError(classifyAuthError(result.error));
      return;
    }
    setSentTo(email.trim());
  }

  if (byPhone) return <ProviderPhoneRecovery />;

  if (sentTo) {
    return (
      <p className="mt-8 rounded-md bg-info-soft px-4 py-4 text-body text-neutral-700">
        {t("recoveryEmailSent", { email: sentTo })}
      </p>
    );
  }

  return (
    <form onSubmit={requestLink} className="mt-6 flex flex-col gap-4">
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
      {error && <RecoveryErrorNote error={error} />}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-brand px-6 py-3 text-body font-semibold text-white transition-colors duration-fast hover:bg-brand-strong disabled:opacity-50"
      >
        {t("recoverySendLink")}
      </button>
      <button
        type="button"
        onClick={() => setByPhone(true)}
        className="text-small font-medium text-brand hover:underline"
      >
        {t("recoveryByPhone")}
      </button>
    </form>
  );
}

function ProviderPhoneRecovery() {
  const t = useTranslations("web.auth");
  const [step, setStep] = useState<RecoveryStep>("request");
  const [phone, setPhone] = useState("");
  const [normalized, setNormalized] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [invalidPhone, setInvalidPhone] = useState(false);

  const request = trpc.identity.requestProviderRecoveryOtp.useMutation({
    onSuccess: () => setStep("otp"),
  });
  const reset = trpc.identity.resetProviderPasswordByOtp.useMutation({
    onSuccess: () => setStep("done"),
  });

  function requestCode(event: FormEvent) {
    event.preventDefault();
    setInvalidPhone(false);
    const e164 = normalizePhone(phone);
    if (!e164) {
      setInvalidPhone(true);
      return;
    }
    setNormalized(e164);
    request.mutate({ phone: e164 });
  }

  function resetByOtp(event: FormEvent) {
    event.preventDefault();
    reset.mutate({ phone: normalized, code: code.trim(), newPassword });
  }

  if (step === "done") return <RecoveryDone />;

  if (step === "otp") {
    const error = reset.error ? classifyTrpcError(reset.error) : null;
    return (
      <form onSubmit={resetByOtp} className="mt-6 flex flex-col gap-4">
        <p className="text-small text-neutral-600">
          {t("recoveryCodeSent", { phone: normalized })}
        </p>
        <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
          {t("recoveryCode")}
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
        <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
          {t("newPassword")}
          <input
            required
            type="password"
            minLength={8}
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className={FIELD}
          />
        </label>
        {error && <RecoveryErrorNote error={error} />}
        <button
          type="submit"
          disabled={reset.isPending}
          className="rounded-md bg-brand px-6 py-3 text-body font-semibold text-white transition-colors duration-fast hover:bg-brand-strong disabled:opacity-50"
        >
          {t("resetPassword")}
        </button>
      </form>
    );
  }

  const error = invalidPhone ? "phone" : request.error ? classifyTrpcError(request.error) : null;
  return (
    <form onSubmit={requestCode} className="mt-6 flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-small font-medium text-neutral-600">
        {t("phone")}
        <input
          required
          type="tel"
          dir="ltr"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          className={FIELD}
        />
        <span className="font-normal text-caption text-neutral-500">{t("phoneHint")}</span>
      </label>
      {error && <RecoveryErrorNote error={error} />}
      <button
        type="submit"
        disabled={request.isPending}
        className="rounded-md bg-brand px-6 py-3 text-body font-semibold text-white transition-colors duration-fast hover:bg-brand-strong disabled:opacity-50"
      >
        {t("recoverySendCode")}
      </button>
    </form>
  );
}
