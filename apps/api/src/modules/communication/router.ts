/**
 * Communication tRPC surface (MM-PLAN-001 §5 Phase 7). Every procedure is
 * bound to the caller's own session (§3.6 layer b) — there is no
 * cross-user read or write here, so `authenticatedProcedure` (any role)
 * is sufficient; there is no resource id in the input to check ownership
 * against.
 */
import {
  channelPreferencesSchema,
  listRecentNotificationsInputSchema,
  listRecentNotificationsOutputSchema,
  registerDeviceTokenInputSchema,
  registerDeviceTokenOutputSchema,
  setChannelPreferencesInputSchema,
  setChannelPreferencesOutputSchema,
  unregisterDeviceTokenInputSchema,
  unregisterDeviceTokenOutputSchema,
} from "@mesomed/contracts/communication";
import { authenticatedProcedure, roleProcedure } from "../../kernel/authz.js";
import { router } from "../../kernel/trpc.js";
import { registerDeviceToken } from "./commands/register-device-token.js";
import { unregisterDeviceToken } from "./commands/unregister-device-token.js";
import { setChannelPreferences } from "./commands/channel-preferences.js";
import { getChannelPreferences } from "./queries/channel-preferences.js";
import { listRecentNotifications } from "./queries/notification-feed.js";

export function createCommunicationRouter() {
  return router({
    registerDeviceToken: authenticatedProcedure
      .input(registerDeviceTokenInputSchema)
      .output(registerDeviceTokenOutputSchema)
      .mutation(({ ctx, input }) => registerDeviceToken(ctx.db, ctx.session.userId, input)),

    // ADR-0011 F-9: a logout flow calls this so the device stops receiving
    // push once the session ends.
    unregisterDeviceToken: authenticatedProcedure
      .input(unregisterDeviceTokenInputSchema)
      .output(unregisterDeviceTokenOutputSchema)
      .mutation(({ ctx, input }) => unregisterDeviceToken(ctx.db, ctx.session.userId, input)),

    setChannelPreferences: authenticatedProcedure
      .input(setChannelPreferencesInputSchema)
      .output(setChannelPreferencesOutputSchema)
      .mutation(({ ctx, input }) => setChannelPreferences(ctx.db, ctx.session.userId, input)),

    getChannelPreferences: authenticatedProcedure
      .output(channelPreferencesSchema)
      .query(({ ctx }) => getChannelPreferences(ctx.db, ctx.session.userId)),

    // ADR-0011 F-14: previously an unmounted, untested query — mounted
    // admin-only since it's a general ops read, not a support-grant-gated
    // clinical view (its column selection already excludes PII, see
    // notification-feed.ts).
    listRecentNotifications: roleProcedure("admin")
      .input(listRecentNotificationsInputSchema)
      .output(listRecentNotificationsOutputSchema)
      .query(({ ctx, input }) => listRecentNotifications(ctx.db, input)),
  });
}
