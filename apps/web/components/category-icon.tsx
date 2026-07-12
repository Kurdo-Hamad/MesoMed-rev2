import {
  Ambulance,
  Baby,
  Brain,
  Building2,
  FlaskConical,
  HeartPulse,
  Hospital,
  House,
  Microscope,
  Pill,
  ScanLine,
  Sparkles,
  Stethoscope,
  Syringe,
  TestTube,
  type LucideIcon,
} from "lucide-react";

/**
 * Taxonomy rows carry a lucide icon key (e.g. "building-2") chosen in the
 * admin suite, resolved against this curated healthcare set. A static
 * allowlist is deliberate: the full `icons` map ships ~500 KB and lucide's
 * DynamicIcon manifest ~240 KB — both sank the §3.8 performance budget.
 * An icon key outside the set falls back to the stethoscope (never an
 * empty slot); extending the set is one import + one map line.
 */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  ambulance: Ambulance,
  baby: Baby,
  brain: Brain,
  "building-2": Building2,
  "flask-conical": FlaskConical,
  "heart-pulse": HeartPulse,
  hospital: Hospital,
  house: House,
  microscope: Microscope,
  pill: Pill,
  "scan-line": ScanLine,
  sparkles: Sparkles,
  stethoscope: Stethoscope,
  syringe: Syringe,
  "test-tube": TestTube,
};

export function CategoryIcon({
  iconKey,
  className,
}: {
  iconKey: string | null;
  className?: string;
}) {
  const Icon = (iconKey ? CATEGORY_ICONS[iconKey] : undefined) ?? Stethoscope;
  return <Icon className={className} aria-hidden="true" />;
}
