import { useTranslations } from "next-intl";
import { Link } from "../i18n/navigation";
import { LocaleSwitcher } from "./locale-switcher";

export function SiteHeader() {
  const t = useTranslations("web");

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="text-subtitle font-bold text-brand">
          {t("brand.name")}
        </Link>
        <nav className="hidden items-center gap-6 text-small font-medium text-neutral-600 sm:flex">
          <Link href="/directory" className="transition-colors duration-fast hover:text-ink">
            {t("nav.directory")}
          </Link>
          <Link href="/search" className="transition-colors duration-fast hover:text-ink">
            {t("nav.search")}
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <LocaleSwitcher />
          <Link
            href="/auth/sign-in"
            className="rounded-md bg-brand px-4 py-2 text-small font-medium text-white transition-colors duration-fast hover:bg-brand-strong"
          >
            {t("nav.signIn")}
          </Link>
        </div>
      </div>
    </header>
  );
}
