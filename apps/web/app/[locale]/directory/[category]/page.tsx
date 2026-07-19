import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@mesomed/i18n";
import type { ListCategoriesOutput } from "@mesomed/contracts/directory";
import { Link } from "../../../../i18n/navigation";
import { pickText } from "../../../../lib/localized";
import { activeCountry, publicServerQuery } from "../../../../lib/server-api";
import { CategoryBrowse } from "./category-browse";

/**
 * Category landing (ADR-0055): a deferred-visible category ("coming_soon"
 * in the gating config) is on the homepage and reachable, but has no
 * providers to browse — it renders the Coming Soon landing instead, out of
 * the index. Active categories render the browse UI as before.
 */
/** Dynamic on the origin: the gating status is live data, read per country. */
export const dynamic = "force-dynamic";

type CategoryParams = Promise<{ locale: Locale; category: string }>;

async function loadCategory(locale: Locale, slug: string) {
  const categories = await publicServerQuery<ListCategoriesOutput>(
    "directory.listCategories",
    undefined,
    { locale, revalidate: 300 },
  );
  return categories?.categories.find((row) => row.slug === slug) ?? null;
}

export async function generateMetadata({ params }: { params: CategoryParams }): Promise<Metadata> {
  const { locale, category } = await params;
  const row = await loadCategory(locale, category);
  return row?.status === "coming_soon" ? { robots: { index: false, follow: false } } : {};
}

export default async function CategoryPage({ params }: { params: CategoryParams }) {
  const { locale, category } = await params;
  const t = await getTranslations("web.directory");
  const row = await loadCategory(locale, category);
  const title = row ? pickText(row.name, locale) : t("title");

  if (row?.status === "coming_soon") return <ComingSoon title={title} />;
  return <CategoryBrowse category={category} country={await activeCountry()} title={title} />;
}

async function ComingSoon({ title }: { title: string }) {
  const tComing = await getTranslations("web.comingSoon");

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-20 text-center">
      <h1 className="text-title font-bold text-ink">{title}</h1>
      <p className="mt-4 text-subtitle font-semibold text-brand">{tComing("title")}</p>
      <p className="mx-auto mt-3 max-w-xl text-body text-neutral-500">{tComing("body")}</p>
      <Link
        href="/"
        className="mt-8 inline-block rounded-md bg-brand px-6 py-2.5 text-small font-medium text-white transition-colors duration-fast hover:bg-brand-strong"
      >
        {tComing("backHome")}
      </Link>
    </main>
  );
}
