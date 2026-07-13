import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { DevSettings, I18nManager } from "react-native";
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
  const [locale, setLocale] = useState<Locale>(defaultLocale);

  useEffect(() => {
    currentLocale = locale;
    if (needsRtlReload(locale, I18nManager.isRTL)) {
      void applyRtlAndReload(locale);
    }
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale }), [locale]);

  return (
    <LocaleContext.Provider value={value}>
      <IntlProvider locale={locale} messages={locales[locale]} timeZone="Asia/Baghdad">
        {children}
      </IntlProvider>
    </LocaleContext.Provider>
  );
}
