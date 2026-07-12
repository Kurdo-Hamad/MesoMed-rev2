"use client";

import { useTranslations } from "next-intl";
import { trpc } from "../../lib/trpc";

/** Placeholder home — replaced by the homepage slice (hero, categories, feed). */
export default function HomePage() {
  const t = useTranslations("hello");
  const health = trpc.health.check.useQuery();

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-2 px-4">
      <h1 className="text-title font-bold text-brand">{t("title")}</h1>
      <p className="text-body text-neutral-500">
        {health.isLoading ? t("checking") : health.data ? t("subtitle") : t("unreachable")}
      </p>
    </main>
  );
}
