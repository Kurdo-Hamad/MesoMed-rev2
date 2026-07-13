import { Pressable, ScrollView, Text } from "react-native";

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * Mobile has no native `<select>` equivalent to apps/web's FilterSelect —
 * a horizontally scrollable chip row is the idiomatic RN pattern for the
 * same job (pick one of a short list of city/specialty/entity filters).
 */
export function FilterChips({
  options,
  value,
  onChange,
}: {
  options: FilterOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row gap-2">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            className={
              selected
                ? "me-2 rounded-full bg-brand px-4 py-2"
                : "me-2 rounded-full border border-line bg-canvas px-4 py-2"
            }
          >
            <Text
              className={
                selected
                  ? "text-small font-semibold text-white"
                  : "text-small font-medium text-neutral-600"
              }
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
