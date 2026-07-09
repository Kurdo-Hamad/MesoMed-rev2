"use client";

import { defaultLocale, locales } from "@mesomed/i18n";
import { colors } from "@mesomed/ui-tokens";
import { trpc } from "../lib/trpc";

export default function HomePage() {
  const health = trpc.health.check.useQuery();
  // Every user-facing string comes from the catalogs (MM-PLAN-001 §3.10).
  const t = locales[defaultLocale].hello;

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        gap: 8,
        color: colors.foreground,
      }}
    >
      <h1 style={{ fontSize: 28 }}>{t.title}</h1>
      <p>{health.isLoading ? t.checking : health.data ? t.subtitle : t.unreachable}</p>
    </main>
  );
}
