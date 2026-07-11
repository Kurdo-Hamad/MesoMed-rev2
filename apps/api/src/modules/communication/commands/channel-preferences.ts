/**
 * Channel-preference writes (MM-DEC §6, own-row-only per §3.6 layer b —
 * the router binds `userId` to the session, never to caller input).
 */
import { userChannelPreferences, type DbExecutor } from "@mesomed/db";
import {
  DEFAULT_CHANNEL_PREFERENCES,
  type ChannelPreferences,
} from "@mesomed/contracts/communication";
import { getChannelPreferences } from "../queries/channel-preferences.js";

export async function setChannelPreferences(
  db: DbExecutor,
  userId: string,
  input: Partial<ChannelPreferences>,
): Promise<ChannelPreferences> {
  const current = await getChannelPreferences(db, userId);
  const next: ChannelPreferences = {
    pushEnabled: input.pushEnabled ?? current.pushEnabled,
    whatsappEnabled: input.whatsappEnabled ?? current.whatsappEnabled,
    smsEnabled: input.smsEnabled ?? current.smsEnabled,
    emailEnabled: input.emailEnabled ?? current.emailEnabled,
    locale: input.locale !== undefined ? input.locale : current.locale,
  };

  await db
    .insert(userChannelPreferences)
    .values({ userId, ...next, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userChannelPreferences.userId,
      set: { ...next, updatedAt: new Date() },
    });

  return next;
}

/** Defaults exposed for the router's initial-read path (no row yet). */
export { DEFAULT_CHANNEL_PREFERENCES };
