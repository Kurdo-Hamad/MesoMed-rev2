import { useEffect, useRef } from "react";
import {
  I18nManager,
  Image,
  Platform,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useTranslations } from "use-intl";
import { HERO_AD_IMAGES } from "../constants/placeholder-images";
import { Scrim } from "./scrim";

const ROTATE_MS = 3000;

// Under RTL, Android's horizontal ScrollView exposes raw physical offsets
// (page 0 sits at the maximum offset) while iOS normalizes both contentOffset
// and scrollTo to logical start-relative values — so the page index must be
// mirrored on Android only. The mapping is its own inverse.
const mirrorsRtl = Platform.OS === "android" && I18nManager.isRTL;

function offsetPage(index: number): number {
  return mirrorsRtl ? HERO_AD_IMAGES.length - 1 - index : index;
}

/**
 * Full-width rotating ad carousel: swipeable paged photos, auto-advance
 * every 3s (paused while the user is interacting), "Sponsored" pill pinned
 * top-end, light reading-start fade. Plain ScrollView + setInterval — no
 * carousel dependency.
 */
export function HeroCarousel() {
  const tFeed = useTranslations("web.home.feed");
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const indexRef = useRef(0);
  const interactingRef = useRef(false);

  useEffect(() => {
    // Re-align the current page after a width change (pagingEnabled does not
    // re-snap an already-settled offset).
    scrollRef.current?.scrollTo({ x: offsetPage(indexRef.current) * width, animated: false });
    const id = setInterval(() => {
      if (interactingRef.current) {
        return;
      }
      indexRef.current = (indexRef.current + 1) % HERO_AD_IMAGES.length;
      scrollRef.current?.scrollTo({ x: offsetPage(indexRef.current) * width, animated: true });
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [width]);

  return (
    <View>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScrollBeginDrag={() => {
          interactingRef.current = true;
        }}
        onMomentumScrollEnd={(event) => {
          const page = Math.round(event.nativeEvent.contentOffset.x / width);
          indexRef.current = offsetPage(Math.min(Math.max(page, 0), HERO_AD_IMAGES.length - 1));
          interactingRef.current = false;
        }}
      >
        {HERO_AD_IMAGES.map((uri) => (
          <View key={uri} style={{ width }} className="aspect-[16/9]">
            <Image source={{ uri }} className="h-full w-full" resizeMode="cover" />
            <View className="absolute inset-y-0 w-2/5" style={{ insetInlineStart: 0 }}>
              <Scrim direction="from-start" color="#FFFFFF" maxOpacity={0.55} />
            </View>
          </View>
        ))}
      </ScrollView>
      <View
        className="absolute top-3 rounded-full bg-black/50 px-2.5 py-1"
        style={{ insetInlineEnd: 12 }}
      >
        <Text className="text-caption font-medium text-white">{tFeed("promoted")}</Text>
      </View>
    </View>
  );
}
