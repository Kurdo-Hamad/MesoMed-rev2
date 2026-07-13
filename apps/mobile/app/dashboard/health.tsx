import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import { useTranslations } from "use-intl";
import { formatLocalizedDate } from "@mesomed/i18n";
import { BLOOD_TYPES, MEDICATION_SOURCES } from "@mesomed/contracts/clinical";
import { FilterChips } from "../../components/filter-chips";
import { useLocale } from "../../lib/locale";
import { trpc } from "../../lib/trpc";

const FIELD = "h-11 w-full rounded-md border border-line bg-canvas px-3 text-body text-ink";

/**
 * Patient health record (ADR-0010 self-view): prescriptions issued to the
 * patient (read-only revision chains), the patient-authored medical
 * profile, and patient-reported medications — kept structurally separate
 * from prescriptions, never merged. Visit notes are deliberately absent.
 * Parity with apps/web/app/[locale]/dashboard/health/page.tsx.
 */
export default function HealthScreen() {
  const t = useTranslations("web.dashboard");
  const record = trpc.clinical.myClinicalRecord.useQuery();

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-4 pb-10">
      <Stack.Screen options={{ title: t("healthTitle") }} />
      <Text className="text-title font-bold text-ink">{t("healthTitle")}</Text>
      {record.isLoading ? (
        <View className="mt-6 gap-4">
          <View className="h-40 rounded-lg bg-neutral-100" />
          <View className="h-40 rounded-lg bg-neutral-100" />
        </View>
      ) : !record.data ? (
        <Text className="mt-6 rounded-md bg-surface px-4 py-3 text-body text-neutral-500">
          {t("healthEmpty")}
        </Text>
      ) : (
        <>
          <MedicalProfileCard profile={record.data.medicalProfile} />
          <ReportedMedications medications={record.data.reportedMedications} />
          <Prescriptions chains={record.data.prescriptionChains} />
        </>
      )}
    </ScrollView>
  );
}

function MedicalProfileCard({
  profile,
}: {
  profile: { bloodType: string; allergies: string[]; notes: string | null } | null;
}) {
  const t = useTranslations("web.dashboard");
  const { locale } = useLocale();
  const listFormat = new Intl.ListFormat(locale, { style: "narrow" });
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [bloodType, setBloodType] = useState(profile?.bloodType ?? "unknown");
  const [allergies, setAllergies] = useState((profile?.allergies ?? []).join(", "));
  const [notes, setNotes] = useState(profile?.notes ?? "");

  const upsert = trpc.clinical.upsertMedicalProfile.useMutation({
    onSuccess: () => {
      setEditing(false);
      void utils.clinical.myClinicalRecord.invalidate();
    },
  });

  function submit() {
    const list = allergies
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    upsert.mutate({
      bloodType: bloodType as (typeof BLOOD_TYPES)[number],
      allergies: list,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
  }

  return (
    <View className="mt-6 rounded-lg border border-line bg-surface p-5">
      <View className="flex-row items-center justify-between">
        <Text className="text-heading font-bold text-ink">{t("medicalProfile")}</Text>
        {!editing && (
          <Pressable
            onPress={() => setEditing(true)}
            className="rounded-md border border-line px-4 py-1.5"
          >
            <Text className="text-small font-medium text-neutral-600">
              {profile ? t("edit") : t("addProfile")}
            </Text>
          </Pressable>
        )}
      </View>

      {editing ? (
        <View className="mt-4 gap-4">
          <View className="gap-1">
            <Text className="text-small font-medium text-neutral-600">{t("bloodType")}</Text>
            <FilterChips
              value={bloodType}
              onChange={setBloodType}
              options={BLOOD_TYPES.map((type) => ({
                value: type,
                label: type === "unknown" ? t("bloodTypeUnknown") : type,
              }))}
            />
          </View>
          <View className="gap-1">
            <Text className="text-small font-medium text-neutral-600">{t("allergies")}</Text>
            <TextInput
              value={allergies}
              onChangeText={setAllergies}
              placeholder={t("allergiesHint")}
              className={FIELD}
            />
          </View>
          <View className="gap-1">
            <Text className="text-small font-medium text-neutral-600">{t("profileNotes")}</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={2}
              textAlignVertical="top"
              className="h-16 w-full rounded-md border border-line bg-canvas px-3 py-2 text-body text-ink"
            />
          </View>
          {upsert.error && (
            <Text className="rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger">
              {t("saveFailed")}
            </Text>
          )}
          <View className="flex-row gap-2">
            <Pressable
              onPress={submit}
              disabled={upsert.isPending}
              className="rounded-md bg-brand px-6 py-2 disabled:opacity-50"
            >
              <Text className="text-small font-semibold text-white">{t("save")}</Text>
            </Pressable>
            <Pressable onPress={() => setEditing(false)} className="rounded-md px-4 py-2">
              <Text className="text-small font-medium text-neutral-500">{t("cancelEdit")}</Text>
            </Pressable>
          </View>
        </View>
      ) : profile ? (
        <View className="mt-3 gap-1">
          <Text className="text-body text-neutral-700">
            <Text className="font-medium">{t("bloodType")}: </Text>
            {profile.bloodType === "unknown" ? t("bloodTypeUnknown") : profile.bloodType}
          </Text>
          <Text className="text-body text-neutral-700">
            <Text className="font-medium">{t("allergies")}: </Text>
            {profile.allergies.length > 0 ? listFormat.format(profile.allergies) : t("none")}
          </Text>
          {profile.notes && <Text className="text-small text-neutral-500">{profile.notes}</Text>}
        </View>
      ) : (
        <Text className="mt-3 text-small text-neutral-500">{t("noProfile")}</Text>
      )}
    </View>
  );
}

function ReportedMedications({
  medications,
}: {
  medications: Array<{
    reportedMedicationId: string;
    medicationName: string;
    dosage: string | null;
    source: string;
  }>;
}) {
  const t = useTranslations("web.dashboard");
  const utils = trpc.useUtils();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [dosage, setDosage] = useState("");
  const [source, setSource] = useState<(typeof MEDICATION_SOURCES)[number]>("over_the_counter");

  const add = trpc.clinical.addReportedMedication.useMutation({
    onSuccess: () => {
      setAdding(false);
      setName("");
      setDosage("");
      void utils.clinical.myClinicalRecord.invalidate();
    },
  });
  const remove = trpc.clinical.removeReportedMedication.useMutation({
    onSuccess: () => void utils.clinical.myClinicalRecord.invalidate(),
  });

  return (
    <View className="mt-6 rounded-lg border border-line bg-surface p-5">
      <View className="flex-row items-center justify-between">
        <Text className="text-heading font-bold text-ink">{t("reportedMedications")}</Text>
        {!adding && (
          <Pressable
            onPress={() => setAdding(true)}
            className="rounded-md border border-line px-4 py-1.5"
          >
            <Text className="text-small font-medium text-neutral-600">{t("addMedication")}</Text>
          </Pressable>
        )}
      </View>
      <Text className="mt-1 text-caption text-neutral-500">{t("reportedMedicationsHint")}</Text>

      {adding && (
        <View className="mt-4 gap-4">
          <View className="gap-1">
            <Text className="text-small font-medium text-neutral-600">{t("medicationName")}</Text>
            <TextInput value={name} onChangeText={setName} className={FIELD} />
          </View>
          <View className="gap-1">
            <Text className="text-small font-medium text-neutral-600">{t("dosage")}</Text>
            <TextInput value={dosage} onChangeText={setDosage} className={FIELD} />
          </View>
          <View className="gap-1">
            <Text className="text-small font-medium text-neutral-600">{t("medicationSource")}</Text>
            <FilterChips
              value={source}
              onChange={(value) => setSource(value as typeof source)}
              options={MEDICATION_SOURCES.map((value) => ({
                value,
                label: t(`source_${value}`),
              }))}
            />
          </View>
          <View className="flex-row gap-2">
            <Pressable
              onPress={() =>
                name.trim() &&
                add.mutate({
                  medicationName: name.trim(),
                  source,
                  ...(dosage.trim() ? { dosage: dosage.trim() } : {}),
                })
              }
              disabled={add.isPending}
              className="rounded-md bg-brand px-6 py-2 disabled:opacity-50"
            >
              <Text className="text-small font-semibold text-white">{t("save")}</Text>
            </Pressable>
            <Pressable onPress={() => setAdding(false)} className="rounded-md px-4 py-2">
              <Text className="text-small font-medium text-neutral-500">{t("cancelEdit")}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {medications.length === 0 ? (
        <Text className="mt-3 text-small text-neutral-500">{t("none")}</Text>
      ) : (
        <View className="mt-3 gap-2">
          {medications.map((medication) => (
            <View
              key={medication.reportedMedicationId}
              className="flex-row items-center justify-between gap-3 rounded-md border border-line bg-canvas px-4 py-2.5"
            >
              <View className="min-w-0 flex-1">
                <Text className="text-body font-medium text-ink">{medication.medicationName}</Text>
                <Text className="text-caption text-neutral-500">
                  {medication.dosage ? `${medication.dosage} · ` : ""}
                  {t(`source_${medication.source}`)}
                </Text>
              </View>
              <Pressable
                disabled={remove.isPending}
                onPress={() =>
                  remove.mutate({ reportedMedicationId: medication.reportedMedicationId })
                }
                className="disabled:opacity-50"
              >
                <Text className="text-small font-medium text-neutral-500">{t("remove")}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function Prescriptions({
  chains,
}: {
  chains: Array<{
    revisions: Array<{
      prescriptionId: string;
      medicationName: string;
      dosage: string;
      frequency: string;
      duration: string;
      instructions: string | null;
      status: string;
      issuedAt: string;
    }>;
  }>;
}) {
  const t = useTranslations("web.dashboard");
  const { locale } = useLocale();
  const dateLabel = (value: string) =>
    formatLocalizedDate(new Date(value), locale, { dateStyle: "medium" });

  return (
    <View className="mt-6 rounded-lg border border-line bg-surface p-5">
      <Text className="text-heading font-bold text-ink">{t("prescriptions")}</Text>
      {chains.length === 0 ? (
        <Text className="mt-3 text-small text-neutral-500">{t("noPrescriptions")}</Text>
      ) : (
        <View className="mt-3 gap-2">
          {chains.map((chain) => {
            const latest = chain.revisions[chain.revisions.length - 1]!;
            return (
              <View
                key={latest.prescriptionId}
                className="rounded-md border border-line bg-canvas px-4 py-3"
              >
                <View className="flex-row flex-wrap items-center justify-between gap-2">
                  <Text className="text-body font-semibold text-ink">{latest.medicationName}</Text>
                  <View
                    className={`rounded-sm px-2 py-0.5 ${
                      latest.status === "active" ? "bg-success-soft" : "bg-neutral-100"
                    }`}
                  >
                    <Text
                      className={`text-caption font-semibold ${
                        latest.status === "active" ? "text-success" : "text-neutral-500"
                      }`}
                    >
                      {t(`prescription_${latest.status}`)}
                    </Text>
                  </View>
                </View>
                <Text className="mt-1 text-small text-neutral-600">
                  {latest.dosage} · {latest.frequency} · {latest.duration}
                </Text>
                {latest.instructions && (
                  <Text className="mt-1 text-small text-neutral-500">{latest.instructions}</Text>
                )}
                <Text
                  className="mt-1 text-caption text-neutral-400"
                  style={{ writingDirection: "ltr" }}
                >
                  {dateLabel(latest.issuedAt)}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
