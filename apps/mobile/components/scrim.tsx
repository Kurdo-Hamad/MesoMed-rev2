import { I18nManager, StyleSheet } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

interface ScrimProps {
  /**
   * "to-top": fully opaque at the bottom edge fading to transparent at the
   * top. "from-start": fully opaque at the reading-start edge fading toward
   * the reading end (flips with RTL — SVG coordinates don't).
   */
  direction: "to-top" | "from-start";
  color: string;
  maxOpacity: number;
}

/**
 * Gradient overlay for photos, absolutely filling its parent. Uses
 * react-native-svg (already a dependency) — expo-linear-gradient stays out
 * per convention #8 (no speculative second adapter/dep).
 */
export function Scrim({ direction, color, maxOpacity }: ScrimProps) {
  const horizontal = direction === "from-start";
  const startIsRight = horizontal && I18nManager.isRTL;
  const id = `scrim-${direction}-${color}-${maxOpacity}-${startIsRight ? "rtl" : "ltr"}`;
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
      <Defs>
        <LinearGradient
          id={id}
          x1={horizontal ? (startIsRight ? "1" : "0") : "0"}
          y1={horizontal ? "0" : "1"}
          x2={horizontal ? (startIsRight ? "0" : "1") : "0"}
          y2="0"
        >
          <Stop offset="0" stopColor={color} stopOpacity={maxOpacity} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}
