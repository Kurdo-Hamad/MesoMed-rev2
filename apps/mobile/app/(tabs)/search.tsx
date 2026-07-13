import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { AlertTriangle, Search as SearchIcon, Stethoscope } from "lucide-react-native";
import { Link } from "expo-router";
import { useTranslations } from "use-intl";
import { colors, semantic } from "@mesomed/ui-tokens";
import { FilterChips } from "../../components/filter-chips";
import { useLocale } from "../../lib/locale";
import { pickText } from "../../lib/localized";
import { trpc } from "../../lib/trpc";

type EntityFilter = "all" | "facility" | "doctor";
type Mode = "text" | "symptoms";

/**
 * Search: text search + symptom triage tabs. Parity with
 * apps/web/app/[locale]/search/page.tsx — same published queries
 * (search.listings, ai.triageSymptoms, directory.listSpecialties).
 */
export default function SearchScreen() {
  const t = useTranslations("web.search");
  const [mode, setMode] = useState<Mode>("text");

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-4 pb-10">
      <Text className="text-title font-bold text-ink">{t("title")}</Text>
      <View className="mt-5 flex-row gap-2">
        <Pressable
          onPress={() => setMode("text")}
          className={
            mode === "text"
              ? "rounded-md bg-brand px-4 py-2"
              : "rounded-md border border-line bg-canvas px-4 py-2"
          }
        >
          <Text
            className={
              mode === "text"
                ? "text-small font-semibold text-white"
                : "text-small font-medium text-neutral-600"
            }
          >
            {t("tabText")}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setMode("symptoms")}
          className={
            mode === "symptoms"
              ? "rounded-md bg-brand px-4 py-2"
              : "rounded-md border border-line bg-canvas px-4 py-2"
          }
        >
          <Text
            className={
              mode === "symptoms"
                ? "text-small font-semibold text-white"
                : "text-small font-medium text-neutral-600"
            }
          >
            {t("tabSymptoms")}
          </Text>
        </Pressable>
      </View>

      {mode === "text" ? <TextSearch /> : <SymptomSearch />}
    </ScrollView>
  );
}

function TextSearch() {
  const t = useTranslations("web.search");
  const { locale } = useLocale();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [entityFilter, setEntityFilter] = useState<EntityFilter>("all");

  const results = trpc.search.listings.useQuery(
    { query, entityType: entityFilter === "all" ? undefined : entityFilter, limit: 20 },
    { enabled: query.trim().length > 0 },
  );

  return (
    <View className="mt-6">
      <View className="flex-row items-center gap-2 rounded-md border border-line bg-canvas px-3">
        <SearchIcon size={18} color={colors.muted} />
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => setQuery(input.trim())}
          returnKeyType="search"
          placeholder={t("inputPlaceholder")}
          className="h-11 flex-1 text-body text-ink"
        />
      </View>
      <View className="mt-3">
        <FilterChips
          value={entityFilter}
          onChange={(value) => setEntityFilter(value as EntityFilter)}
          options={[
            { value: "all", label: t("filterAll") },
            { value: "facility", label: t("filterFacilities") },
            { value: "doctor", label: t("filterDoctors") },
          ]}
        />
      </View>

      {query &&
        (results.isLoading ? (
          <View className="mt-6 gap-2">
            {Array.from({ length: 5 }, (_, index) => (
              <View key={index} className="h-16 rounded-md bg-neutral-100" />
            ))}
          </View>
        ) : (results.data?.items.length ?? 0) === 0 ? (
          <Text className="mt-6 rounded-lg border border-line bg-surface px-4 py-10 text-center text-body text-neutral-500">
            {t("noResults")}
          </Text>
        ) : (
          <View className="mt-6 gap-2">
            {results.data!.items.map((item) => (
              <Link
                key={`${item.entityType}-${item.entityId}`}
                href={
                  item.entityType === "facility" ? `/facility/${item.slug}` : `/doctor/${item.slug}`
                }
                asChild
              >
                <Pressable className="flex-row items-center justify-between rounded-md border border-line bg-canvas px-4 py-3 shadow-card">
                  <View className="min-w-0 flex-1">
                    <Text numberOfLines={1} className="text-body font-semibold text-ink">
                      {pickText(item.name, locale)}
                    </Text>
                    <Text className="text-caption text-neutral-500">
                      {item.entityType === "facility" ? t("filterFacilities") : t("filterDoctors")}
                    </Text>
                  </View>
                </Pressable>
              </Link>
            ))}
          </View>
        ))}
    </View>
  );
}

function SymptomSearch() {
  const t = useTranslations("web.search");
  const { locale } = useLocale();
  const [text, setText] = useState("");
  const triage = trpc.ai.triageSymptoms.useMutation();
  const specialties = trpc.directory.listSpecialties.useQuery();

  const suggested = (triage.data?.specialties ?? [])
    .map((key) => specialties.data?.specialties.find((row) => row.key === key))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  return (
    <View className="mt-6">
      <View className="mb-4 flex-row items-start gap-2 rounded-md bg-info-soft px-4 py-3">
        <Stethoscope size={16} color={semantic.info} />
        <Text className="flex-1 text-small text-neutral-700">{t("triage.disclaimer")}</Text>
      </View>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={t("symptomPlaceholder")}
        multiline
        numberOfLines={4}
        maxLength={1000}
        textAlignVertical="top"
        className="h-28 rounded-md border border-line bg-canvas px-4 py-3 text-body text-ink"
      />
      <Pressable
        onPress={() => text.trim() && triage.mutate({ text: text.trim() })}
        disabled={triage.isPending || !text.trim()}
        className="mt-3 self-start rounded-md bg-brand px-6 py-2.5 disabled:opacity-50"
      >
        <Text className="text-body font-semibold text-white">{t("analyze")}</Text>
      </Pressable>

      {triage.error && (
        <Text className="mt-4 rounded-md bg-warning-soft px-4 py-3 text-small text-neutral-700">
          {t("triage.rateLimited")}
        </Text>
      )}

      {triage.data?.redFlag && (
        <View className="mt-4 flex-row items-start gap-2 rounded-md bg-danger-soft px-4 py-4">
          <AlertTriangle size={20} color={colors.foreground} />
          <Text className="flex-1 text-body font-medium text-danger">{t("triage.redFlag")}</Text>
        </View>
      )}

      {triage.data && !triage.data.redFlag && (
        <View className="mt-6">
          {suggested.length === 0 ? (
            <Text className="rounded-lg border border-line bg-surface px-4 py-8 text-center text-body text-neutral-500">
              {t("triage.noMatch")}
            </Text>
          ) : (
            <>
              <Text className="mb-3 text-heading font-bold text-ink">
                {t("triage.suggestions")}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {suggested.map((specialty) => (
                  <Link
                    key={specialty.key}
                    href={{ pathname: "/directory/doctors", params: { specialty: specialty.key } }}
                    asChild
                  >
                    <Pressable className="rounded-md border border-brand bg-brand-soft px-4 py-2">
                      <Text className="text-small font-semibold text-brand">
                        {pickText(specialty.name, locale)}
                      </Text>
                    </Pressable>
                  </Link>
                ))}
              </View>
              <Link href="/directory/doctors" className="mt-3 text-caption text-brand">
                {t("triage.viewDoctors")}
              </Link>
            </>
          )}
        </View>
      )}
    </View>
  );
}
