"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Link } from "../../../../i18n/navigation";
import { authClient } from "../../../../lib/auth-client";

const FIELD =
  "h-11 w-full rounded-md border border-line bg-canvas px-3 text-body text-ink shadow-card outline-none transition-shadow duration-fast focus:border-brand";

export function ResetPasswordForm() {
  // useSearchParams requires a Suspense boundary on statically rendered pages.
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}

/**
 * Landing page for the provider email reset link (MM-DEC rev02 §5,
 * MM-QA-004 F-01). Better Auth appends ?token=… to the redirect, or
 * ?error=… when the link is invalid/expired — classified on the query
 * param, never on message text (convention #11).
 */
function ResetPasswordInner() {
  const t = useTranslations("web.auth");
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const linkError = searchParams.get("error");
  const [newPassword, setNewPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<"rateLimited" | "failed" | null>(null);
  const [done, setDone] = useState(false);

  async function reset(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setFailed(null);
    setPending(true);
    const result = await authClient.resetPassword({ newPassword, token });
    setPending(false);
    if (result.error) {
      setFailed(result.error.status === 429 ? "rateLimited" : "failed");
      return;
    }
    setDone(true);
  }

  if (!token || linkError) {
    return (
      <div className="mt-8 flex flex-col items-center gap-4 text-center">
        <p className="w-full rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger">
          {t("resetInvalidToken")}
        </p>
        <Link
          href="/auth/forgot-password"
          className="text-small font-medium text-brand hover:underline"
        >
          {t("forgotPassword")}
        </Link>
      </div>
    );
  }

  if (done) {
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

  return (
    <form onSubmit={reset} className="mt-6 flex flex-col gap-4">
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
      {failed && (
        <p className="rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger">
          {failed === "rateLimited" ? t("recoveryRateLimited") : t("resetFailed")}
        </p>
      )}
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
