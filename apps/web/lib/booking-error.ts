import { ErrorCode } from "@mesomed/contracts/errors";

/**
 * Convention #11: booking errors classify on the typed `data.appCode` the
 * kernel error formatter ships — never on message text (MM-QA-004 F-05;
 * mirrors apps/mobile/app/book/[slug].tsx). The parameter type deliberately
 * omits `message` so reading it here is a type error.
 */
export function classifyBookingError(error: {
  data?: { appCode?: string } | null;
}): "slotTaken" | "failed" {
  return error.data?.appCode === ErrorCode.SLOT_UNAVAILABLE ? "slotTaken" : "failed";
}
