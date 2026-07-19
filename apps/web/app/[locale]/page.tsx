import { getTranslations } from "next-intl/server";
import type { Locale } from "@mesomed/i18n";
import type { HomepageTile } from "@mesomed/contracts/directory";
import { CategoryIcon } from "../../components/category-icon";
import { HomeInteractive } from "../../components/home/home-interactive";
import { Link } from "../../i18n/navigation";
import { pickText } from "../../lib/localized";
import { activeCountry, publicServerQuery } from "../../lib/server-api";

/**
 * Homepage (MM-PLAN-001 §5 Phase 8): hero + category cards + recommended
 * feed. Hero heading and the category grid are server-rendered (ADR-0012
 * layer 1 — public, short-revalidate): the LCP heading paints with the
 * document instead of waiting on hydration (§3.8 performance budget).
 * Search + city-reactive feed stay client islands (HomeInteractive).
 */
/**
 * Dynamic on the origin: the homepage reads live directory data, so it
 * must not be frozen into the build (builds run without the API). Public
 * caching is the HTTP/CDN layer's job (ADR-0012 layer 1); the data reads
 * below additionally ride the Next data cache via revalidate.
 */
export const dynamic = "force-dynamic";

export default async function HomePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const tHero = await getTranslations("web.home.hero");
  const tCategories = await getTranslations("web.home.categories");
  const tTiles = await getTranslations("web.home.tiles");

  // Per-country tile set (ADR-0055): the configured list for this country,
  // or every active category where none is configured.
  const tiles = await publicServerQuery<HomepageTile[]>("directory.listHomepageTiles", undefined, {
    locale,
    revalidate: 300,
  });
  const country = await activeCountry();

  return (
    <main>
      <section className="bg-gradient-to-b from-brand-soft to-canvas">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-4 pt-16 text-center sm:pt-20">
          <h1 className="max-w-3xl text-balance text-title font-bold text-ink sm:text-display">
            {tHero("title")}
          </h1>
          <p className="max-w-2xl text-balance text-subtitle text-neutral-600">
            {tHero("subtitle")}
          </p>
        </div>
      </section>

      <HomeInteractive
        country={country}
        staticSections={
          <section className="mx-auto w-full max-w-6xl px-4 py-10">
            <h2 className="mb-5 text-heading font-bold text-ink">{tCategories("heading")}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(tiles ?? []).map((tile) =>
                tile.kind === "doctors" ? (
                  <HomeTile
                    key="doctors"
                    href="/directory/doctors"
                    iconKey="stethoscope"
                    label={tTiles("doctors")}
                  />
                ) : (
                  <HomeTile
                    key={tile.slug}
                    href={`/directory/${tile.slug}`}
                    iconKey={tile.iconKey}
                    label={pickText(tile.name, locale)}
                  />
                ),
              )}
            </div>
          </section>
        }
      />
    </main>
  );
}

function HomeTile({
  href,
  iconKey,
  label,
}: {
  href: string;
  iconKey: string | null;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="group flex h-24 flex-col items-center justify-center gap-2 rounded-lg border border-line bg-canvas shadow-card transition-all duration-base hover:border-brand hover:shadow-raised"
    >
      <CategoryIcon
        iconKey={iconKey}
        className="h-6 w-6 text-brand transition-transform duration-base group-hover:scale-110"
      />
      <span className="px-2 text-center text-small font-medium text-ink">{label}</span>
    </Link>
  );
}
