/**
 * Admin category gating command (ADR-0055): reads the current gating config
 * row through the kernel config service, applies one category's status and
 * writes it back Zod-validated. The value is the single gating authority —
 * queries resolve it via `readCategoryGating` (fail-open: unlisted =
 * active); no code lists categories.
 */
import type { z } from "zod";
import type { setCategoryGatingInputSchema } from "@mesomed/contracts/directory";
import {
  CATEGORY_GATING_CONFIG_KEY,
  categoryGatingSchema,
  readCategoryGating,
} from "@mesomed/config";
import type { ConfigService } from "../../../kernel/config.js";

export async function setCategoryGating(
  config: ConfigService,
  input: z.output<typeof setCategoryGatingInputSchema>,
): Promise<{ slug: string }> {
  const gating = await readCategoryGating(config);
  await config.set(categoryGatingSchema, CATEGORY_GATING_CONFIG_KEY, {
    ...gating,
    [input.slug]: input.status,
  });
  return { slug: input.slug };
}
