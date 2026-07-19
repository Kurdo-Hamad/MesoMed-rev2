import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { CardSkeleton } from "../../../../components/listing-cards";
import { activeCountry } from "../../../../lib/server-api";
import { DoctorsBrowse } from "./doctors-browse";

/** Dynamic on the origin: the browse country is read per request (ADR-0055). */
export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;

export default async function DoctorsBrowsePage() {
  const t = await getTranslations("web.directory");
  // The heading and the reserved grid render in the static shell — the
  // useSearchParams boundary must not delay the LCP heading or let the
  // footer jump when the grid hydrates (CLS).
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <h1 className="text-title font-bold text-ink">{t("doctors")}</h1>
      <Suspense
        fallback={
          <div
            aria-busy="true"
            className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
          >
            {Array.from({ length: PAGE_SIZE }, (_, index) => (
              <CardSkeleton key={index} />
            ))}
          </div>
        }
      >
        <DoctorsBrowse country={await activeCountry()} />
      </Suspense>
    </main>
  );
}
