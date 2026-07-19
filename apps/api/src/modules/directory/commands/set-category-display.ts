/**
 * Admin per-country homepage tile command (ADR-0055): reads the current
 * display config row through the kernel config service, wholesale-replaces
 * one country's ordered tile list and writes it back Zod-validated. A
 * country absent from the map falls back to the full active category list
 * (`resolveCategoryDisplay` returns null) — IQ is deliberately unlisted.
 */
import type { z } from "zod";
import type { setCategoryDisplayInputSchema } from "@mesomed/contracts/directory";
import {
  CATEGORY_DISPLAY_CONFIG_KEY,
  categoryDisplaySchema,
  type CategoryDisplay,
} from "@mesomed/config";
import type { ConfigService } from "../../../kernel/config.js";

export async function setCategoryDisplay(
  config: ConfigService,
  input: z.output<typeof setCategoryDisplayInputSchema>,
): Promise<{ countryIso: string }> {
  let display: CategoryDisplay = {};
  try {
    display = await config.get(categoryDisplaySchema, CATEGORY_DISPLAY_CONFIG_KEY);
  } catch (error) {
    if ((error as { code?: string }).code !== "NOT_FOUND") throw error;
  }
  await config.set(categoryDisplaySchema, CATEGORY_DISPLAY_CONFIG_KEY, {
    ...display,
    [input.countryIso]: input.tiles,
  });
  return { countryIso: input.countryIso };
}
