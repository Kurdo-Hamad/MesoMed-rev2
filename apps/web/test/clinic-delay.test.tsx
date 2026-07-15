// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { NextIntlClientProvider } from "next-intl";
import { locales } from "@mesomed/i18n";
import ClinicPage from "../app/[locale]/dashboard/clinic/page";
import { trpc } from "../lib/trpc";
import { ACCOUNTS, createClinicClient, TIME_ZONE, type ClinicClient } from "./clinic-client.js";

/**
 * Phase 9c Slice 3 (MM-DES-002 §7/§9, the ADR-0020 F-07 web migration):
 * the REAL clinic page rendered against a live API (global-setup.ts) with
 * a real browser session — every button on screen is a server affordance.
 * Proves through the actual UI that delay moves a row into the delayed
 * section with recall on offer, that recall returns it, and that a row
 * the server offers no actions for renders zero action buttons.
 */

/** Catalog strings the assertions use (never hardcoded — convention #10). */
const T = locales.en.web.dashboard;

const dayKey = (instant: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(instant);

describe("web clinic page renders server affordances", () => {
  let clinic: ClinicClient;
  let secretaryCookie = "";
  let doctorCookie = "";

  beforeAll(async () => {
    clinic = createClinicClient(inject("clinicBaseURL"), inject("clinicDoctorLocationId"));
    secretaryCookie = await clinic.signInCookie(ACCOUNTS.secretary.email);
    doctorCookie = await clinic.signInCookie(ACCOUNTS.doctor.email);
  });

  afterEach(cleanup);

  function renderClinic(cookie: string) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const client = trpc.createClient({
      links: [
        httpBatchLink({
          url: `${clinic.baseURL}/trpc`,
          // The browser attaches the session via credentials: include
          // (app/providers.tsx); node fetch carries it explicitly.
          fetch: (url, options) =>
            fetch(url, {
              ...options,
              headers: { ...(options?.headers as Record<string, string>), cookie },
            }),
        }),
      ],
    });
    return render(
      <trpc.Provider client={client} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <NextIntlClientProvider locale="en" messages={locales.en}>
            <ClinicPage />
          </NextIntlClientProvider>
        </QueryClientProvider>
      </trpc.Provider>,
    );
  }

  /** The page opens on today; the fixture books a week out — walk the
   * day navigation to the slot's date in the location timezone. */
  async function goToDay(startsAt: string) {
    const target = dayKey(new Date(startsAt));
    let cursor = new Date();
    let clicks = 0;
    while (dayKey(cursor) !== target) {
      cursor = new Date(cursor.getTime() + 86_400_000);
      clicks += 1;
      if (clicks > 14) throw new Error(`slot date ${target} unreachable from today`);
    }
    const next = await screen.findByRole("button", { name: T.nextDay });
    for (let i = 0; i < clicks; i += 1) fireEvent.click(next);
  }

  async function findRow(patientName: string) {
    const name = await screen.findByText(patientName);
    const row = name.closest("li");
    expect(row).not.toBeNull();
    return row!;
  }

  it("doctor delays a late patient and recalls them — buttons are server affordances only", async () => {
    const booked = await clinic.bookSlot("Late Patient");
    const confirmed = await clinic.rpc(
      "booking.confirm",
      "mutation",
      { appointmentId: booked.appointmentId },
      secretaryCookie,
    );
    expect(confirmed.status).toBe(200);

    renderClinic(doctorCookie);
    await goToDay(booked.startsAt);
    let row = await findRow("Late Patient");

    // Confirmed, seen by the doctor: the server offers noShow/cancel/delay.
    // checkIn is FRONT_DESK — its absence here proves the buttons are the
    // server's affordances, not a local role map.
    await within(row).findByRole("button", { name: T.action_delay });
    expect(within(row).queryByRole("button", { name: T.action_checkIn })).toBeNull();

    fireEvent.click(within(row).getByRole("button", { name: T.action_delay }));

    // The row lands in the delayed section (presentation-only grouping,
    // MM-DES-002 §3) with recall on offer and delay withdrawn.
    await screen.findByRole("heading", { name: T.status_delayed });
    row = await findRow("Late Patient");
    await within(row).findByRole("button", { name: T.action_recall });
    expect(within(row).getByText(T.status_delayed)).toBeDefined();
    expect(within(row).queryByRole("button", { name: T.action_delay })).toBeNull();

    fireEvent.click(within(row).getByRole("button", { name: T.action_recall }));

    // Recall returns the patient to the active list as checked_in; with no
    // delayed rows left the section heading disappears.
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: T.status_delayed })).toBeNull();
    });
    row = await findRow("Late Patient");
    expect(within(row).getByText(T.status_checked_in)).toBeDefined();
    await within(row).findByRole("button", { name: T.action_start });
  });

  it("a row the server offers no actions for renders zero action buttons", async () => {
    const booked = await clinic.bookSlot("Cancelled Patient");
    const cancelled = await clinic.rpc(
      "booking.cancel",
      "mutation",
      { appointmentId: booked.appointmentId },
      secretaryCookie,
    );
    expect(cancelled.status).toBe(200);

    renderClinic(doctorCookie);
    await goToDay(booked.startsAt);
    const row = await findRow("Cancelled Patient");

    expect(within(row).getByText(T.status_cancelled)).toBeDefined();
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
  });
});
