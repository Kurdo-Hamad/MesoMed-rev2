/**
 * Search module tRPC surface (MM-PLAN-001 §5 Phase 3). Public, country-
 * gated like every public directory read (§3.9).
 */
import { searchInputSchema, searchOutputSchema } from "@mesomed/contracts/search";
import { publicProcedure, router } from "../../kernel/trpc.js";
import { assertCountryActive } from "../../kernel/gating.js";
import { searchListings } from "./queries/search-listings.js";

export function createSearchRouter() {
  return router({
    listings: publicProcedure
      .input(searchInputSchema)
      .output(searchOutputSchema)
      .query(async ({ ctx, input }) => {
        await assertCountryActive(ctx.config, ctx.country);
        return searchListings(ctx.db, ctx.country, input);
      }),
  });
}
