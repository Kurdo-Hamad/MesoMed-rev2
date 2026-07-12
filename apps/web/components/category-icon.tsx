import { icons, Stethoscope, type LucideIcon } from "lucide-react";

/**
 * Taxonomy rows carry a lucide icon key (e.g. "building-2") chosen in the
 * admin suite. Unknown or missing keys fall back to a neutral icon rather
 * than an empty slot.
 */
function iconFor(iconKey: string | null): LucideIcon {
  if (!iconKey) return Stethoscope;
  const pascal = iconKey
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return (icons as Record<string, LucideIcon>)[pascal] ?? Stethoscope;
}

export function CategoryIcon({
  iconKey,
  className,
}: {
  iconKey: string | null;
  className?: string;
}) {
  const Icon = iconFor(iconKey);
  return <Icon className={className} aria-hidden="true" />;
}
