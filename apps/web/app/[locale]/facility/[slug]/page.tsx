import { getTranslations } from "next-intl/server";
import Image from "next/image";
import { Building2, Globe, Mail, MapPin, Phone } from "lucide-react";
import type { Locale } from "@mesomed/i18n";
import type { FacilityDetailOutput } from "@mesomed/contracts/directory";
import { pickOptionalText, pickText } from "../../../../lib/localized";
import { mediaUrl } from "../../../../lib/media";
import { publicServerQuery } from "../../../../lib/server-api";

/**
 * Public facility detail — server-rendered (ADR-0012 layer 1: public,
 * non-personalized, short-revalidate). The client-fetch version pushed
 * LCP past the Lighthouse budget: gallery and name only painted after
 * the JS + query waterfall; here they arrive in the document.
 */
export default async function FacilityDetailPage({
  params,
}: {
  params: Promise<{ locale: Locale; slug: string }>;
}) {
  const { locale, slug } = await params;
  const t = await getTranslations("web.facility");

  const facility = await publicServerQuery<FacilityDetailOutput>(
    "directory.facilityDetail",
    { slugOrId: slug },
    { locale, revalidate: 300 },
  );

  if (!facility) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-20 text-center">
        <p className="text-subtitle text-neutral-500">{t("notFound")}</p>
      </main>
    );
  }
  const about = pickOptionalText(facility.about, locale);
  const whyChooseUs = pickOptionalText(facility.whyChooseUs, locale);
  const address = pickOptionalText(facility.address, locale);
  const sections = groupSections(facility.sections);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      {/* Media gallery: first image leads, the rest in a strip. */}
      {facility.media.length > 0 ? (
        <div className="grid grid-cols-4 gap-2">
          <div className="relative col-span-4 aspect-[3/1] overflow-hidden rounded-lg sm:col-span-3 sm:aspect-[2/1]">
            <Image
              src={mediaUrl(facility.media[0]!.path)}
              alt={
                pickOptionalText(facility.media[0]!.alt, locale) ?? pickText(facility.name, locale)
              }
              fill
              sizes="(max-width: 640px) 100vw, 75vw"
              className="object-cover"
              priority
            />
          </div>
          <div className="col-span-4 grid grid-cols-4 gap-2 sm:col-span-1 sm:grid-cols-1">
            {facility.media.slice(1, 4).map((item) => (
              <div key={item.path} className="relative aspect-[4/3] overflow-hidden rounded-lg">
                <Image
                  src={mediaUrl(item.path)}
                  alt={pickOptionalText(item.alt, locale) ?? ""}
                  fill
                  sizes="25vw"
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex aspect-[3/1] items-center justify-center rounded-lg bg-brand-soft">
          <Building2 className="h-16 w-16 text-brand-300" aria-hidden="true" />
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-title font-bold text-ink">{pickText(facility.name, locale)}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-body text-neutral-500">
            <MapPin className="h-4 w-4" aria-hidden="true" />
            {pickText(facility.cityName, locale)}
            <span aria-hidden="true">·</span>
            {pickText(facility.categoryName, locale)}
          </p>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="flex flex-col gap-8 lg:col-span-2">
          {about && <TextBlock heading={t("about")} body={about} />}
          {whyChooseUs && <TextBlock heading={t("whyChooseUs")} body={whyChooseUs} />}
          {sections.map((group) => (
            <section key={group.key}>
              <h2 className="mb-3 text-heading font-bold text-ink">
                {pickText(group.label, locale)}
              </h2>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {group.items.map((section) => (
                  <li
                    key={section.id}
                    className="rounded-md border border-line bg-surface px-3 py-2 text-small text-ink"
                  >
                    {pickText(section.name, locale)}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <aside className="h-fit rounded-lg border border-line bg-surface p-5">
          <h2 className="mb-4 text-subtitle font-bold text-ink">{t("contact")}</h2>
          <dl className="flex flex-col gap-3 text-small">
            {address && <ContactRow icon={MapPin} label={t("address")} value={address} />}
            {facility.phone && (
              <ContactRow icon={Phone} label={t("phone")} value={facility.phone} dir="ltr" />
            )}
            {facility.email && (
              <ContactRow icon={Mail} label={t("email")} value={facility.email} dir="ltr" />
            )}
            {facility.websiteOrSocial && (
              <ContactRow
                icon={Globe}
                label={t("website")}
                value={facility.websiteOrSocial}
                dir="ltr"
              />
            )}
          </dl>
        </aside>
      </div>
    </main>
  );
}

function TextBlock({ heading, body }: { heading: string; body: string }) {
  return (
    <section>
      <h2 className="mb-3 text-heading font-bold text-ink">{heading}</h2>
      <p className="whitespace-pre-line text-body leading-7 text-neutral-700">{body}</p>
    </section>
  );
}

function ContactRow({
  icon: Icon,
  label,
  value,
  dir,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
  dir?: "ltr";
}) {
  // A <dl> may only group dt/dd inside a single <div> wrapper — deeper
  // nesting breaks the definition-list accessibility contract.
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="flex items-center gap-2.5 text-caption text-neutral-500">
        <Icon className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
        {label}
      </dt>
      {/* Phone/email/URL stay LTR inside RTL layouts. */}
      <dd className="break-words ps-7 text-ink" dir={dir}>
        {value}
      </dd>
    </div>
  );
}

interface SectionRow {
  id: string;
  sectionTypeKey: string;
  sectionTypeLabel: { en: string; ar: string; ckb: string };
  name: { en: string; ar: string; ckb: string };
  imagePath: string | null;
}

function groupSections(sections: SectionRow[]) {
  const groups = new Map<
    string,
    { key: string; label: SectionRow["sectionTypeLabel"]; items: SectionRow[] }
  >();
  for (const section of sections) {
    const group = groups.get(section.sectionTypeKey) ?? {
      key: section.sectionTypeKey,
      label: section.sectionTypeLabel,
      items: [],
    };
    group.items.push(section);
    groups.set(section.sectionTypeKey, group);
  }
  return [...groups.values()];
}
