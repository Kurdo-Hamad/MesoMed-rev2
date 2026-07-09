// ALLOWED: modules depend on kernel infrastructure.
import { log } from "../../kernel/logger.js";

export function betaCommand(): void {
  log("beta");
}
