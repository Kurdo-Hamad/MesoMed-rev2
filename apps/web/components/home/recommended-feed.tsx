"use client";

import { useTranslations } from "next-intl";
import { Link } from "../../i18n/navigation";
import { trpc } from "../../lib/trpc";
import { CardSkeleton, DoctorCard, FacilityCard } from "../listing-cards";

const FEED_LIMIT = 8;

/**
 * Consumes the directory's featured-slot resolver (`homepageFeed` — curated
 * promotions first, effective tier-1 fill; ADR-0005) through the published
 * query only (§1.9 module discipline: no wide "get everything" call).
 */
export function RecommendedFeed({ citySlug }: { citySlug: string | undefined }) {
  const t = useTranslations("web.home.feed");
  const feed = trpc.directory.homepageFeed.useQuery({ citySlug, limit: FEED_LIMIT });

  const slots = feed.data?.slots ?? [];

  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-14">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 className="text-heading font-bold text-ink">{t("heading")}</h2>
        <Link
          href="/directory"
          className="text-small font-medium text-brand transition-colors duration-fast hover:text-brand-strong"
        >
          {t("viewDirectory")}
        </Link>
      </div>
      {feed.isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: FEED_LIMIT }, (_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
      ) : slots.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-10 text-center text-body text-neutral-500">
          {t("empty")}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {slots.map((slot) =>
            slot.kind === "facility" ? (
              <FacilityCard
                key={`f-${slot.facility.slug}`}
                facility={slot.facility}
                promoted={slot.promoted}
              />
            ) : (
              <DoctorCard
                key={`d-${slot.doctor.slug}`}
                doctor={slot.doctor}
                promoted={slot.promoted}
              />
            ),
          )}
        </div>
      )}
    </section>
  );
}
