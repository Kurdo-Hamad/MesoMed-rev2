import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { trpc } from "../lib/trpc";

// API listens on 4000 (MM-QA-001 F-06). On a physical device "localhost"
// is the phone — set EXPO_PUBLIC_API_URL to the dev machine's LAN address.
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [httpBatchLink({ url: `${API_URL}/trpc` })],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
      </QueryClientProvider>
    </trpc.Provider>
  );
}
