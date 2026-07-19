import {
  Activity,
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
  Scale,
  Scissors,
  ShoppingBag,
  Smile,
  Sparkles,
  Stethoscope,
  Syringe,
  TestTube,
  Video,
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
  activity: Activity,
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
  scale: Scale,
  "scan-line": ScanLine,
  scissors: Scissors,
  "shopping-bag": ShoppingBag,
  sparkles: Sparkles,
  stethoscope: Stethoscope,
  syringe: Syringe,
  "test-tube": TestTube,
  // lucide ships no tooth glyph; the smile is the dental stand-in for the
  // dental_clinic row's "tooth" key, which otherwise fell back to the
  // stethoscope like every unknown key.
  tooth: Smile,
  video: Video,
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
