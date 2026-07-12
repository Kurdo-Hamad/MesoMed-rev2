"use client";

import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { Building2, UserRound } from "lucide-react";
import type { Locale } from "@mesomed/i18n";
import { Link } from "../i18n/navigation";
import { pickOptionalText, pickText, type LocalizedText } from "../lib/localized";
import { mediaUrl } from "../lib/media";

export interface FacilityCardData {
  slug: string;
  name: LocalizedText;
  cityName: LocalizedText;
  featured: boolean;
  photoPath: string | null;
}

export interface DoctorCardData {
  slug: string;
  name: LocalizedText;
  specialtyName: LocalizedText | null;
  cityName: LocalizedText | null;
  photoUrl: string | null;
}

function Badge({ tone, children }: { tone: "featured" | "promoted"; children: string }) {
  const classes =
    tone === "featured"
      ? "bg-featured-soft text-featured"
      : "bg-neutral-100 text-neutral-600 border border-line";
  return (
    <span
      className={`absolute top-2 start-2 rounded-sm px-2 py-0.5 text-caption font-semibold ${classes}`}
    >
      {children}
    </span>
  );
}

function CardImage({
  src,
  alt,
  fallback,
}: {
  src: string | null;
  alt: string;
  fallback: "facility" | "doctor";
}) {
  if (src) {
    return (
      <Image
        src={mediaUrl(src)}
        alt={alt}
        fill
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
        className="object-cover"
      />
    );
  }
  const Icon = fallback === "facility" ? Building2 : UserRound;
  return (
    <div className="flex h-full w-full items-center justify-center bg-brand-soft">
      <Icon className="h-10 w-10 text-brand-300" aria-hidden="true" />
    </div>
  );
}

/** Facility card: image, name, city, featured/sponsored badge. */
export function FacilityCard({
  facility,
  promoted,
}: {
  facility: FacilityCardData;
  promoted?: boolean;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations("web.home.feed");

  return (
    <Link
      href={`/facility/${facility.slug}`}
      className="group overflow-hidden rounded-lg border border-line bg-canvas shadow-card transition-shadow duration-base hover:shadow-raised"
    >
      <div className="relative aspect-[4/3]">
        <CardImage
          src={facility.photoPath}
          alt={pickText(facility.name, locale)}
          fallback="facility"
        />
        {promoted ? (
          <Badge tone="promoted">{t("promoted")}</Badge>
        ) : facility.featured ? (
          <Badge tone="featured">{t("featured")}</Badge>
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5 p-3">
        <span className="truncate text-body font-semibold text-ink group-hover:text-brand">
          {pickText(facility.name, locale)}
        </span>
        <span className="truncate text-small text-neutral-500">
          {pickText(facility.cityName, locale)}
        </span>
      </div>
    </Link>
  );
}

/** Doctor card: photo, name, specialty, city. */
export function DoctorCard({ doctor, promoted }: { doctor: DoctorCardData; promoted?: boolean }) {
  const locale = useLocale() as Locale;
  const t = useTranslations("web.home.feed");
  const specialty = pickOptionalText(doctor.specialtyName, locale);
  const city = pickOptionalText(doctor.cityName, locale);

  return (
    <Link
      href={`/doctor/${doctor.slug}`}
      className="group overflow-hidden rounded-lg border border-line bg-canvas shadow-card transition-shadow duration-base hover:shadow-raised"
    >
      <div className="relative aspect-[4/3]">
        <CardImage src={doctor.photoUrl} alt={pickText(doctor.name, locale)} fallback="doctor" />
        {promoted ? <Badge tone="promoted">{t("promoted")}</Badge> : null}
      </div>
      <div className="flex flex-col gap-0.5 p-3">
        <span className="truncate text-body font-semibold text-ink group-hover:text-brand">
          {pickText(doctor.name, locale)}
        </span>
        <span className="truncate text-small text-neutral-500">
          {[specialty, city].filter(Boolean).join(" · ")}
        </span>
      </div>
    </Link>
  );
}

/** Loading placeholder matching the card footprint (premium pass: skeletons). */
export function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-canvas shadow-card">
      <div className="aspect-[4/3] animate-pulse bg-neutral-100" />
      <div className="flex flex-col gap-2 p-3">
        <div className="h-4 w-3/4 animate-pulse rounded-sm bg-neutral-100" />
        <div className="h-3 w-1/2 animate-pulse rounded-sm bg-neutral-100" />
      </div>
    </div>
  );
}
