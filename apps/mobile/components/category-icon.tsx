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
} from "lucide-react-native";

/**
 * Taxonomy rows carry a lucide icon key chosen in the admin suite, resolved
 * against this curated healthcare set. Mirrors
 * apps/web/components/category-icon.tsx's allowlist exactly (one brand
 * definition, two renderers) — an icon key outside the set falls back to
 * the stethoscope, never an empty slot.
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
  size = 24,
  color,
}: {
  iconKey: string | null;
  size?: number;
  color: string;
}) {
  const Icon = (iconKey ? CATEGORY_ICONS[iconKey] : undefined) ?? Stethoscope;
  return <Icon size={size} color={color} />;
}
