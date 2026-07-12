"use client";

import { use } from "react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { MapPin, UserRound } from "lucide-react";
import type { Locale } from "@mesomed/i18n";
import { Link } from "../../../../i18n/navigation";
import { pickOptionalText, pickText } from "../../../../lib/localized";
import { mediaUrl } from "../../../../lib/media";
import { trpc } from "../../../../lib/trpc";

export default function DoctorDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const t = useTranslations("web.doctor");
  const locale = useLocale() as Locale;
  const detail = trpc.directory.doctorDetail.useQuery({ slugOrId: slug });

  if (detail.isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl animate-pulse px-4 py-10">
        <div className="flex gap-6">
          <div className="h-36 w-36 rounded-lg bg-neutral-100" />
          <div className="flex-1">
            <div className="h-8 w-1/2 rounded-sm bg-neutral-100" />
            <div className="mt-3 h-4 w-1/3 rounded-sm bg-neutral-100" />
          </div>
        </div>
        <div className="mt-8 h-32 rounded-lg bg-neutral-100" />
      </div>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-20 text-center">
        <p className="text-subtitle text-neutral-500">{t("notFound")}</p>
      </main>
    );
  }

  const doctor = detail.data;
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
          {/* Booking flow lands in the booking slice; the CTA routes there. */}
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
