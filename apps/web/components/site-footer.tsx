import { useTranslations } from "next-intl";

export function SiteFooter() {
  const t = useTranslations("web");

  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-8 text-small text-neutral-500">
        <p className="font-semibold text-ink">
          {t("brand.name")} — {t("footer.tagline")}
        </p>
        <p>
          © {new Date().getFullYear()} {t("brand.name")}. {t("footer.rights")}
        </p>
      </div>
    </footer>
  );
}
