/**
 * HTTP-only clinic helpers, safe under any vitest environment (the render
 * suite runs in jsdom, where the node-only server harness cannot load —
 * see global-setup.ts). Every call goes over the same wire the browser
 * uses: Better Auth email sign-in for the session cookie, tRPC over fetch
 * with the cookie attached as `credentials: include` would.
 */

export const ACCOUNTS = {
  doctor: { email: "clinic-doctor@web-test.mesomed.example", name: "Web Doctor" },
  admin: { email: "clinic-admin@web-test.mesomed.example", name: "Web Admin" },
  secretary: { email: "clinic-secretary@web-test.mesomed.example", name: "Web Secretary" },
} as const;
export const PASSWORD = "correct horse battery";

/** The fixture location's timezone — tests do day math against it. */
export const TIME_ZONE = "Asia/Baghdad";

declare module "vitest" {
  export interface ProvidedContext {
    clinicBaseURL: string;
    clinicDoctorLocationId: string;
  }
}

export interface RpcResult<T> {
  status: number;
  data: T | null;
  /** Typed error code per convention #11 (clients read appCode, never messages). */
  appCode: string | null;
}

export interface ClinicClient {
  baseURL: string;
  doctorLocationId: string;
  rpc<T>(
    path: string,
    kind: "query" | "mutation",
    input?: unknown,
    cookie?: string,
  ): Promise<RpcResult<T>>;
  signInCookie(email: string): Promise<string>;
  /** Guest-books the next open slot a week out; returns the queue item. */
  bookSlot(fullName?: string): Promise<{ appointmentId: string; startsAt: string }>;
}

let guestPhoneCounter = 0;
const takenSlots = new Set<string>();

export function createClinicClient(baseURL: string, doctorLocationId: string): ClinicClient {
  async function rpc<T>(
    path: string,
    kind: "query" | "mutation",
    input?: unknown,
    cookie?: string,
  ): Promise<RpcResult<T>> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (cookie) headers["cookie"] = cookie;
    const res =
      kind === "query"
        ? await fetch(
            `${baseURL}/trpc/${path}${
              input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`
            }`,
            { headers },
          )
        : await fetch(`${baseURL}/trpc/${path}`, {
            method: "POST",
            headers,
            body: JSON.stringify(input ?? {}),
          });
    const body = (await res.json()) as {
      result?: { data: T };
      error?: { data?: { appCode?: string } };
    };
    return {
      status: res.status,
      data: body.result?.data ?? null,
      appCode: body.error?.data?.appCode ?? null,
    };
  }

  async function signInCookie(email: string): Promise<string> {
    const signIn = await fetch(`${baseURL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    if (signIn.status !== 200) throw new Error(`sign-in failed for ${email}: ${signIn.status}`);
    const cookie = signIn.headers
      .getSetCookie()
      .map((entry) => entry.split(";")[0]!)
      .join("; ");
    if (!cookie.includes("session_token")) throw new Error("no session cookie on sign-in");
    return cookie;
  }

  async function bookSlot(
    fullName = "Queue Patient",
  ): Promise<{ appointmentId: string; startsAt: string }> {
    const anchor = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const availability = await rpc<{
      days: Array<{ isPast: boolean; slots: Array<{ startsAt: string }> }>;
    }>("booking.weekAvailability", "query", { doctorLocationId, anchor });
    const slot = availability.data?.days
      .filter((day) => !day.isPast)
      .flatMap((day) => day.slots)
      .find((candidate) => !takenSlots.has(candidate.startsAt));
    if (!slot) throw new Error("no open slot in fixture");
    takenSlots.add(slot.startsAt);
    const phone = `+96477092100${String(++guestPhoneCounter).padStart(2, "0")}`;
    const booked = await rpc<{ appointmentId: string }>("booking.guestBook", "mutation", {
      doctorLocationId,
      startsAt: slot.startsAt,
      patient: { fullName, phone },
    });
    if (booked.status !== 200 || booked.data === null) {
      throw new Error(`guestBook failed in fixture: ${booked.status}`);
    }
    return { appointmentId: booked.data.appointmentId, startsAt: slot.startsAt };
  }

  return { baseURL, doctorLocationId, rpc, signInCookie, bookSlot };
}
