import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/** Locale-aware wrappers around Next navigation — always link through these. */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
