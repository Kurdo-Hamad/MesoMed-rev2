/**
 * Channel-preference reads (MM-DEC §6): a missing row means every channel
 * is enabled at the platform default locale — a user only gets a row once
 * they explicitly set a preference.
 */
import { eq, userChannelPreferences, type DbExecutor } from "@mesomed/db/modules/communication";
import {
  DEFAULT_CHANNEL_PREFERENCES,
  type ChannelPreferences,
} from "@mesomed/contracts/communication";

export async function getChannelPreferences(
  db: DbExecutor,
  userId: string,
): Promise<ChannelPreferences> {
  const [row] = await db
    .select({
      pushEnabled: userChannelPreferences.pushEnabled,
      whatsappEnabled: userChannelPreferences.whatsappEnabled,
      smsEnabled: userChannelPreferences.smsEnabled,
      emailEnabled: userChannelPreferences.emailEnabled,
      locale: userChannelPreferences.locale,
    })
    .from(userChannelPreferences)
    .where(eq(userChannelPreferences.userId, userId))
    .limit(1);
  if (!row) return DEFAULT_CHANNEL_PREFERENCES;
  return {
    pushEnabled: row.pushEnabled,
    whatsappEnabled: row.whatsappEnabled,
    smsEnabled: row.smsEnabled,
    emailEnabled: row.emailEnabled,
    locale: row.locale as ChannelPreferences["locale"],
  };
}
