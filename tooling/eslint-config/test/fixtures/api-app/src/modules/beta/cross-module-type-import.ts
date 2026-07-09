// ALLOWED: type-only cross-module imports carry no runtime coupling.
import type { AlphaSecret } from "../alpha/internal.js";

export type BetaView = { secret: AlphaSecret };
