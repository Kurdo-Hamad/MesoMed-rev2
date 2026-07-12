"use client";

import type { ReactNode } from "react";

export function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      className="h-10 rounded-md border border-line bg-canvas px-3 text-small text-ink shadow-card outline-none focus:border-brand"
    >
      {children}
    </select>
  );
}
