import en from "./messages/en.json";
import ar from "./messages/ar.json";
import ckb from "./messages/ckb.json";

/** ckb (Central Kurdish/Sorani) is the platform default per MM-PLAN-001 §1. */
export const defaultLocale = "ckb" as const;

export const locales = { en, ar, ckb } as const;

export type Locale = keyof typeof locales;

export const rtlLocales: readonly Locale[] = ["ar", "ckb"];

export type Messages = typeof en;
