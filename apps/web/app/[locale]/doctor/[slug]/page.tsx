import { getTranslations } from "next-intl/server";
import Image from "next/image";
import { MapPin, UserRound } from "lucide-react";
import type { Locale } from "@mesomed/i18n";
import { Link } from "../../../../i18n/navigation";
import { pickOptionalText, pickText } from "../../../../lib/localized";
import { mediaUrl } from "../../../../lib/media";
import type { DoctorDetailOutput } from "@mesomed/contracts/directory";
import { publicServerQuery } from "../../../../lib/server-api";

/**
 * Public doctor detail — server-rendered (ADR-0012 layer 1: public,
 * non-personalized, short-revalidate). The client-fetch version pushed
 * LCP past the Lighthouse budget: the name/bio only painted after the
 * JS + query waterfall; here they arrive in the document.
 */
export default async function DoctorDetailPage({
  params,
}: {
  params: Promise<{ locale: Locale; slug: string }>;
}) {
  const { locale, slug } = await params;
  const t = await getTranslations("web.doctor");

  const doctor = await publicServerQuery<DoctorDetailOutput>(
    "directory.doctorDetail",
    { slugOrId: slug },
    { locale, revalidate: 300 },
  );

  if (!doctor) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-20 text-center">
        <p className="text-subtitle text-neutral-500">{t("notFound")}</p>
      </main>
    );
  }

  const specialty = pickOptionalText(doctor.specialtyName, locale);
  const city = pickOptionalText(doctor.cityName, locale);
  const bio = pickOptionalText(doctor.bio, locale);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <div className="relative h-36 w-36 shrink-0 overflow-hidden rounded-lg bg-brand-soft">
          {doctor.photoUrl ? (
            <Image
              src={mediaUrl(doctor.photoUrl)}
              alt={pickText(doctor.name, locale)}
              fill
              sizes="9rem"
              className="object-cover"
              priority
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center">
              <UserRound className="h-12 w-12 text-brand-300" aria-hidden="true" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-title font-bold text-ink">{pickText(doctor.name, locale)}</h1>
          {specialty && <p className="mt-1 text-subtitle text-brand">{specialty}</p>}
          {city && (
            <p className="mt-1 flex items-center gap-1.5 text-body text-neutral-500">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              {city}
            </p>
          )}
          <Link
            href={`/book/${doctor.slug}`}
            className="mt-4 inline-block rounded-md bg-brand px-6 py-2.5 text-body font-semibold text-white transition-colors duration-fast hover:bg-brand-strong"
          >
            {t("book")}
          </Link>
        </div>
      </div>

      {bio && (
        <section className="mt-10">
          <h2 className="mb-3 text-heading font-bold text-ink">{t("bio")}</h2>
          <p className="whitespace-pre-line text-body leading-7 text-neutral-700">{bio}</p>
        </section>
      )}
    </main>
  );
}
