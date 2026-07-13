import "../global.css";
import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ComingSoonScreen } from "../components/coming-soon-screen";
import { UpgradeRequiredScreen } from "../components/upgrade-required-screen";
import { LOCALE_HEADER } from "../lib/api-headers";
import { APP_VERSION_HEADER, getAppVersion } from "../lib/app-version";
import { useCountryComingSoon } from "../lib/country-coming-soon";
import { getCurrentLocale, LocaleProvider } from "../lib/locale";
import { createQueryClient } from "../lib/query-client";
import { trpc } from "../lib/trpc";
import { useUpgradeRequired } from "../lib/upgrade-required";

// API listens on 4000 (MM-QA-001 F-06). On a physical device "localhost"
// is the phone — set EXPO_PUBLIC_API_URL to the dev machine's LAN address.
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

function AppContent() {
  const upgradeRequired = useUpgradeRequired();
  const countryComingSoon = useCountryComingSoon();

  return (
    <>
      <StatusBar style="auto" />
      {upgradeRequired ? (
        <UpgradeRequiredScreen />
      ) : countryComingSoon ? (
        <ComingSoonScreen />
      ) : (
        // The (tabs) group renders its own header-less Tabs bar; every
        // other route (directory/doctor/facility detail) keeps the Stack's
        // default header for its title + back button.
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      )}
    </>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(() => createQueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${API_URL}/trpc`,
          headers: () => ({
            [APP_VERSION_HEADER]: getAppVersion(),
            [LOCALE_HEADER]: getCurrentLocale(),
          }),
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <LocaleProvider>
          <AppContent />
        </LocaleProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
