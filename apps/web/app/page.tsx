"use client";

import { locales } from "@mesomed/i18n";
import { colors } from "@mesomed/ui-tokens";
import { trpc } from "../lib/trpc";

export default function HomePage() {
  const health = trpc.health.check.useQuery();
  const t = locales.en.hello;

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
      <p>{health.isLoading ? "Checking API…" : health.data ? t.subtitle : "API unreachable"}</p>
    </main>
  );
}
