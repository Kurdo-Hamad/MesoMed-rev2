/**
 * Device-token registration (MM-DEC §6): push becomes the primary channel
 * the moment a live token exists. `token` is globally unique — a
 * re-installed app re-registering the same Expo token reassigns it to the
 * current user rather than erroring.
 */
import { deviceTokens, type DbExecutor } from "@mesomed/db";
import type { DevicePlatform } from "@mesomed/contracts/communication";

export interface RegisterDeviceTokenInput {
  token: string;
  platform: DevicePlatform;
}

export async function registerDeviceToken(
  db: DbExecutor,
  userId: string,
  input: RegisterDeviceTokenInput,
): Promise<{ deviceTokenId: string }> {
  const now = new Date();
  const [row] = await db
    .insert(deviceTokens)
    .values({ userId, token: input.token, platform: input.platform, lastSeenAt: now })
    .onConflictDoUpdate({
      target: deviceTokens.token,
      set: { userId, platform: input.platform, lastSeenAt: now },
    })
    .returning({ id: deviceTokens.id });
  return { deviceTokenId: row!.id };
}
