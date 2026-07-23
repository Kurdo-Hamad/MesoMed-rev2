import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { DevSettings, I18nManager } from "react-native";
import * as SecureStore from "expo-secure-store";
import { IntlProvider } from "use-intl";
import { defaultLocale, isRtl, locales, type Locale } from "@mesomed/i18n";
import { needsRtlReload } from "./rtl";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: defaultLocale,
  setLocale: () => undefined,
});

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

// The tRPC httpBatchLink's `headers()` callback (lib/trpc-client.ts) runs
// outside React — it reads this module-level value rather than a hook.
let currentLocale: Locale = defaultLocale;

export function getCurrentLocale(): Locale {
  return currentLocale;
}

// The chosen locale must survive the RTL reload below: without persistence,
// an LTR<->RTL switch reloads into defaultLocale, which reloads straight
// back — the selection can never take effect.
const LOCALE_STORAGE_KEY = "mesomed-locale";

function isStoredLocale(value: string | null): value is Locale {
  return value !== null && value in locales;
}

async function applyRtlAndReload(locale: Locale): Promise<void> {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(isRtl(locale));
  if (__DEV__) {
    DevSettings.reload();
    return;
  }
  const Updates = await import("expo-updates");
  await Updates.reloadAsync();
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  // null = stored locale not read yet; the RTL-reload effect must not run
  // until then, or a pre-hydration defaultLocale would trigger the reload.
  const [locale, setLocaleState] = useState<Locale | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(LOCALE_STORAGE_KEY)
      .then((stored) => setLocaleState(isStoredLocale(stored) ? stored : defaultLocale))
      .catch(() => setLocaleState(defaultLocale));
  }, []);

  useEffect(() => {
    if (locale === null) return;
    currentLocale = locale;
    if (needsRtlReload(locale, I18nManager.isRTL)) {
      void applyRtlAndReload(locale);
    }
  }, [locale]);

  const value = useMemo(
    () => ({
      locale: locale ?? defaultLocale,
      setLocale: (next: Locale) => {
        void SecureStore.setItemAsync(LOCALE_STORAGE_KEY, next).catch(() => undefined);
        setLocaleState(next);
      },
    }),
    [locale],
  );

  if (locale === null) {
    return null;
  }

  return (
    <LocaleContext.Provider value={value}>
      <IntlProvider locale={locale} messages={locales[locale]} timeZone="Asia/Baghdad">
        {children}
      </IntlProvider>
    </LocaleContext.Provider>
  );
}
