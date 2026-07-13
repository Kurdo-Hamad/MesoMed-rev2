import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react-native";
import { Link, Stack, useLocalSearchParams } from "expo-router";
import { useTranslations } from "use-intl";
import { formatLocalizedDate, pinLtr } from "@mesomed/i18n";
import { normalizePhone } from "@mesomed/contracts/phone";
import { ErrorCode } from "@mesomed/contracts/errors";
import { colors, semantic } from "@mesomed/ui-tokens";
import { FilterChips } from "../../components/filter-chips";
import { useLocale } from "../../lib/locale";
import { pickText } from "../../lib/localized";
import { trpc } from "../../lib/trpc";

interface Slot {
  startsAt: string;
  endsAt: string;
}

interface AvailabilityDay {
  date: string;
  isOpen: boolean;
  isPast: boolean;
  isToday: boolean;
  slots: Slot[];
}

interface Availability {
  timeZone: string;
  days: AvailabilityDay[];
}

/**
 * Guest booking (MM-DEC rev02 §1): friction-free — no account, no OTP.
 * Name + phone required; DOB/gender/email optional. Parity with
 * apps/web/app/[locale]/book/[slug]/page.tsx. The API creates/finds the
 * phone-keyed patient profile (bookResult.patientProfileCreated); the
 * confirmation screen offers the optional account (§2) — never as a
 * precondition. That CTA links to /auth/sign-up, which doesn't exist
 * until Slice 4 — omitted here rather than link to a route that isn't
 * there yet (same deferral as Slice 2's doctor-detail Book button).
 */
export default function BookScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const t = useTranslations("web.book");
  const tDoctor = useTranslations("web.doctor");
  const { locale } = useLocale();

  const doctor = trpc.directory.doctorDetail.useQuery({ slugOrId: slug });
  const locations = trpc.scheduling.doctorLocations.useQuery(
    { doctorProfileId: doctor.data?.id ?? "" },
    { enabled: Boolean(doctor.data?.id) },
  );

  const [locationId, setLocationId] = useState<string | undefined>(undefined);
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [slot, setSlot] = useState<Slot | null>(null);

  const activeLocations = useMemo(
    () => (locations.data?.locations ?? []).filter((location) => location.active),
    [locations.data],
  );
  const selectedLocationId = locationId ?? activeLocations[0]?.doctorLocationId;

  const availability = trpc.booking.weekAvailability.useQuery(
    { doctorLocationId: selectedLocationId ?? "", anchor: anchor.toISOString() },
    { enabled: Boolean(selectedLocationId) },
  );

  const book = trpc.booking.guestBook.useMutation({
    onError: (error) => {
      // SLOT_UNAVAILABLE is UX, not error text (Phase 9a Slice 3): the
      // slot someone else just took disappears on refetch, not a dead-end
      // message — appCode drives this, never the message string (§3.11).
      if (error.data?.appCode === ErrorCode.SLOT_UNAVAILABLE) {
        setSlot(null);
        void availability.refetch();
      }
    },
  });

  if (doctor.error) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas px-8">
        <Text className="text-subtitle text-neutral-500">{tDoctor("notFound")}</Text>
      </View>
    );
  }

  if (book.data) {
    return <Confirmation result={book.data} />;
  }

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-4 pb-10">
      <Stack.Screen options={{ title: t("title") }} />
      <Text className="text-title font-bold text-ink">{t("title")}</Text>
      {doctor.data && (
        <Text className="mt-1 text-subtitle text-neutral-600">
          {t("with", { name: pickText(doctor.data.name, locale) })}
        </Text>
      )}

      {activeLocations.length > 1 && (
        <View className="mt-6">
          <Text className="mb-1 text-small font-medium text-neutral-600">{t("location")}</Text>
          <FilterChips
            value={selectedLocationId ?? ""}
            onChange={(value) => {
              setLocationId(value);
              setSlot(null);
            }}
            options={activeLocations.map((location) => ({
              value: location.doctorLocationId,
              label: pickText(location.name, locale),
            }))}
          />
        </View>
      )}

      <WeekGrid
        availability={availability.data}
        loading={availability.isLoading || locations.isLoading || doctor.isLoading}
        selected={slot}
        onSelect={setSlot}
        onWeekShift={(days) => {
          setAnchor((current) => new Date(current.getTime() + days * 86_400_000));
          setSlot(null);
        }}
      />

      {slot && selectedLocationId && (
        <PatientForm
          slot={slot}
          doctorLocationId={selectedLocationId}
          pending={book.isPending}
          slotTakenError={book.error?.data?.appCode === ErrorCode.SLOT_UNAVAILABLE}
          otherError={
            Boolean(book.error) && book.error?.data?.appCode !== ErrorCode.SLOT_UNAVAILABLE
          }
          onSubmit={(input) => book.mutate(input)}
        />
      )}
    </ScrollView>
  );
}

function WeekGrid({
  availability,
  loading,
  selected,
  onSelect,
  onWeekShift,
}: {
  availability: Availability | undefined;
  loading: boolean;
  selected: Slot | null;
  onSelect: (slot: Slot) => void;
  onWeekShift: (days: number) => void;
}) {
  const t = useTranslations("web.book");
  const { locale } = useLocale();

  const dayLabel = (date: Date) =>
    formatLocalizedDate(date, locale, { weekday: "short", day: "numeric", month: "short" });
  const timeLabel = (iso: string) =>
    availability
      ? new Intl.DateTimeFormat(locale, {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: availability.timeZone,
        }).format(new Date(iso))
      : "";

  const hasAnySlot = availability?.days.some((day) => day.slots.length > 0) ?? false;

  return (
    <View className="mt-8">
      <View className="mb-3 flex-row items-center justify-between">
        <Text className="text-heading font-bold text-ink">{t("week")}</Text>
        <View className="flex-row gap-1">
          <Pressable onPress={() => onWeekShift(-7)} className="rounded-md border border-line p-2">
            <ChevronLeft size={16} color={colors.muted} />
          </Pressable>
          <Pressable onPress={() => onWeekShift(7)} className="rounded-md border border-line p-2">
            <ChevronRight size={16} color={colors.muted} />
          </Pressable>
        </View>
      </View>

      {loading || !availability ? (
        <View className="flex-row gap-2">
          {Array.from({ length: 7 }, (_, index) => (
            <View key={index} className="h-40 w-24 rounded-lg bg-neutral-100" />
          ))}
        </View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-2">
              {availability.days.map((day) => (
                <View
                  key={day.date}
                  className={
                    day.isToday
                      ? "w-28 rounded-lg border border-brand p-2"
                      : "w-28 rounded-lg border border-line p-2"
                  }
                >
                  <Text
                    className="mb-2 text-center text-caption font-semibold text-neutral-600"
                    style={{ writingDirection: "ltr" }}
                  >
                    {dayLabel(new Date(`${day.date}T12:00:00`))}
                  </Text>
                  {!day.isOpen || day.isPast ? (
                    <Text className="py-4 text-center text-caption text-neutral-500">
                      {t("closed")}
                    </Text>
                  ) : day.slots.length === 0 ? (
                    <Text className="py-4 text-center text-caption text-neutral-500">—</Text>
                  ) : (
                    <View className="gap-1">
                      {day.slots.map((daySlot) => (
                        <Pressable
                          key={daySlot.startsAt}
                          onPress={() => onSelect(daySlot)}
                          className={
                            selected?.startsAt === daySlot.startsAt
                              ? "rounded-sm bg-brand px-2 py-1"
                              : "rounded-sm bg-brand-soft px-2 py-1"
                          }
                        >
                          <Text
                            className={
                              selected?.startsAt === daySlot.startsAt
                                ? "text-center text-caption font-semibold text-white"
                                : "text-center text-caption font-medium text-brand"
                            }
                          >
                            {timeLabel(daySlot.startsAt)}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              ))}
            </View>
          </ScrollView>
          {!hasAnySlot && (
            <Text className="mt-3 rounded-md bg-surface px-4 py-3 text-center text-small text-neutral-500">
              {t("noSlots")}
            </Text>
          )}
        </>
      )}
    </View>
  );
}

function PatientForm({
  slot,
  doctorLocationId,
  pending,
  slotTakenError,
  otherError,
  onSubmit,
}: {
  slot: Slot;
  doctorLocationId: string;
  pending: boolean;
  slotTakenError: boolean;
  otherError: boolean;
  onSubmit: (input: {
    doctorLocationId: string;
    startsAt: string;
    patient: {
      fullName: string;
      phone: string;
      dateOfBirth?: string;
      gender?: "male" | "female";
      email?: string;
    };
    note?: string;
  }) => void;
}) {
  const t = useTranslations("web.book");
  const { locale } = useLocale();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState<"" | "male" | "female">("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [phoneInvalid, setPhoneInvalid] = useState(false);

  const slotLabel = formatLocalizedDate(new Date(slot.startsAt), locale, {
    dateStyle: "full",
    timeStyle: "short",
  });

  function submit() {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      setPhoneInvalid(true);
      return;
    }
    setPhoneInvalid(false);
    onSubmit({
      doctorLocationId,
      startsAt: slot.startsAt,
      patient: {
        fullName: fullName.trim(),
        phone: normalized,
        ...(dateOfBirth ? { dateOfBirth } : {}),
        ...(gender ? { gender } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
      },
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  }

  const field = "h-11 w-full rounded-md border border-line bg-canvas px-3 text-body text-ink";

  return (
    <View className="mt-8 rounded-lg border border-line bg-surface p-5">
      <Text className="text-heading font-bold text-ink">{t("details")}</Text>
      <Text className="mt-1 text-small text-neutral-600">
        {t("selectedSlot")}:{" "}
        <Text className="font-semibold text-ink" style={{ writingDirection: "ltr" }}>
          {slotLabel}
        </Text>
      </Text>

      <View className="mt-4 gap-4">
        <View className="gap-1">
          <Text className="text-small font-medium text-neutral-600">{t("fullName")}</Text>
          <TextInput value={fullName} onChangeText={setFullName} className={field} />
        </View>
        <View className="gap-1">
          <Text className="text-small font-medium text-neutral-600">{t("phone")}</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="+964…"
            className={field}
            style={{ writingDirection: "ltr" }}
          />
          <Text className="text-caption text-neutral-500">{t("phoneHint")}</Text>
        </View>
        <View className="gap-1">
          <Text className="text-small font-medium text-neutral-600">{t("dateOfBirth")}</Text>
          <TextInput
            value={dateOfBirth}
            onChangeText={setDateOfBirth}
            placeholder="YYYY-MM-DD"
            className={field}
            style={{ writingDirection: "ltr" }}
          />
        </View>
        <View className="gap-1">
          <Text className="text-small font-medium text-neutral-600">{t("gender")}</Text>
          <FilterChips
            value={gender}
            onChange={(value) => setGender(value as "" | "male" | "female")}
            options={[
              { value: "", label: t("genderUnspecified") },
              { value: "male", label: t("male") },
              { value: "female", label: t("female") },
            ]}
          />
        </View>
        <View className="gap-1">
          <Text className="text-small font-medium text-neutral-600">{t("email")}</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            className={field}
            style={{ writingDirection: "ltr" }}
          />
        </View>
        <View className="gap-1">
          <Text className="text-small font-medium text-neutral-600">{t("note")}</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={2}
            maxLength={500}
            textAlignVertical="top"
            className="h-16 w-full rounded-md border border-line bg-canvas px-3 py-2 text-body text-ink"
          />
        </View>
      </View>

      {phoneInvalid && (
        <Text className="mt-4 rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger">
          {t("invalidPhone")}
        </Text>
      )}
      {slotTakenError && (
        <Text className="mt-4 rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger">
          {t("slotTaken")}
        </Text>
      )}
      {otherError && (
        <Text className="mt-4 rounded-md bg-danger-soft px-4 py-3 text-small font-medium text-danger">
          {t("failed")}
        </Text>
      )}

      <Pressable
        onPress={submit}
        disabled={pending}
        className="mt-5 self-start rounded-md bg-brand px-8 py-3 disabled:opacity-50"
      >
        <Text className="text-body font-semibold text-white">{t("submit")}</Text>
      </Pressable>
    </View>
  );
}

function Confirmation({ result }: { result: { startsAt: string } }) {
  const t = useTranslations("web.book");
  const { locale } = useLocale();
  const when = new Date(result.startsAt);
  const date = pinLtr(formatLocalizedDate(when, locale, { dateStyle: "full" }));
  const time = new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(when);

  return (
    <View className="flex-1 items-center px-4 py-16">
      <Stack.Screen options={{ title: t("booked") }} />
      <View className="h-16 w-16 items-center justify-center rounded-full bg-success-soft">
        <CalendarCheck size={32} color={semantic.success} />
      </View>
      <Text className="mt-5 text-title font-bold text-ink">{t("booked")}</Text>
      <Text className="mt-2 text-subtitle text-neutral-700">{t("bookedAt", { date, time })}</Text>
      <Text className="mt-1 text-body text-neutral-500">{t("confirmationNote")}</Text>

      {/* Optional account offer (MM-DEC §2) — after booking, never before.
          Its CTA links to /auth/sign-up, which lands in Slice 4; only the
          skip-to-home path is wired for now. */}
      <View className="mt-10 w-full rounded-lg border border-line bg-surface p-6">
        <Text className="text-body text-neutral-700">{t("accountOffer")}</Text>
        <Link href="/" className="mt-4 self-center text-small font-medium text-neutral-500">
          {t("accountOfferSkip")}
        </Link>
      </View>
    </View>
  );
}
