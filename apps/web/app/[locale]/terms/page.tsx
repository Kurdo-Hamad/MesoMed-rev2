import { getTranslations } from "next-intl/server";

/**
 * Terms of service (MM-QA-004 F-02, Slice 3b / ADR-0034): static,
 * catalog-rendered in all three locales — the canonical copy linked from
 * the site footer and the mobile account screen (convention #10).
 */
const SECTIONS = [
  "service",
  "medical",
  "accounts",
  "providers",
  "use",
  "liability",
  "law",
  "changes",
  "contact",
] as const;

export default async function TermsPage() {
  const t = await getTranslations("web.legal.terms");
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-title font-bold text-ink">{t("title")}</h1>
      <p className="mt-1 text-small text-neutral-500">{t("updated")}</p>
      <p className="mt-6 text-body text-neutral-700">{t("intro")}</p>
      {SECTIONS.map((section) => (
        <section key={section} className="mt-8">
          <h2 className="text-subtitle font-semibold text-ink">{t(`${section}Title`)}</h2>
          <p className="mt-2 text-body text-neutral-700">{t(`${section}Body`)}</p>
        </section>
      ))}
    </main>
  );
}
