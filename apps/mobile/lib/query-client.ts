import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { isCountryComingSoonError, setCountryComingSoon } from "./country-coming-soon";
import { isUpgradeRequiredError, setUpgradeRequired } from "./upgrade-required";

function handleError(error: unknown): void {
  if (isUpgradeRequiredError(error)) setUpgradeRequired(true);
  if (isCountryComingSoonError(error)) setCountryComingSoon(true);
}

/** One QueryClient for the app: any query or mutation hitting the
 * ADR-0013 mobile gate flips the blocking upgrade screen on, from
 * wherever in the tree it happened. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: handleError }),
    mutationCache: new MutationCache({ onError: handleError }),
  });
}
