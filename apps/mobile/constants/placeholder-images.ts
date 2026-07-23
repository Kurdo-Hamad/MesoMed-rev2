// DEV PLACEHOLDER — replace with CDN before launch
//
// Every remote placeholder image URL used by the app lives in this file and
// nowhere else. The category contract has no image field (ADR-0055 tiles are
// iconKey-only), so the Home photo tiles are keyed here by category slug
// (apps/api/scripts/seed/data.ts CATEGORIES) until real CDN imagery lands.

export const HERO_AD_IMAGES: readonly string[] = [
  "https://images.unsplash.com/photo-1586773860418-d37222d8fce3?auto=format&fit=crop&w=1200&q=60",
  "https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&w=1200&q=60",
  "https://images.unsplash.com/photo-1538108149393-fbbd81895907?auto=format&fit=crop&w=1200&q=60",
];

export const CATEGORY_TILE_IMAGES: Record<string, string> = {
  hospital:
    "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=400&q=60",
  dental_clinic:
    "https://images.unsplash.com/photo-1606811841689-23dfddce3e95?auto=format&fit=crop&w=400&q=60",
  beauty_center:
    "https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=400&q=60",
  laboratory:
    "https://images.unsplash.com/photo-1579154204601-01588f351e67?auto=format&fit=crop&w=400&q=60",
  pharmacy:
    "https://images.unsplash.com/photo-1587854692152-cbe660dbde88?auto=format&fit=crop&w=400&q=60",
  home_nursing:
    "https://images.unsplash.com/photo-1584515933487-779824d29309?auto=format&fit=crop&w=400&q=60",
  hair_transplant:
    "https://images.unsplash.com/photo-1620331311520-246422fd82f9?auto=format&fit=crop&w=400&q=60",
  weight_management:
    "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&w=400&q=60",
  physiotherapy:
    "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?auto=format&fit=crop&w=400&q=60",
  medical_marketplace:
    "https://images.unsplash.com/photo-1583947215259-38e31be8751f?auto=format&fit=crop&w=400&q=60",
  online_consultation:
    "https://images.unsplash.com/photo-1622253692010-333f2da6031d?auto=format&fit=crop&w=400&q=60",
};

export const CATEGORY_TILE_FALLBACK =
  "https://images.unsplash.com/photo-1505751172876-fa1923c5c528?auto=format&fit=crop&w=400&q=60";
