/**
 * Communication tRPC surface (MM-PLAN-001 §5 Phase 7). Every procedure is
 * bound to the caller's own session (§3.6 layer b) — there is no
 * cross-user read or write here, so `authenticatedProcedure` (any role)
 * is sufficient; there is no resource id in the input to check ownership
 * against.
 */
import {
  channelPreferencesSchema,
  registerDeviceTokenInputSchema,
  registerDeviceTokenOutputSchema,
  setChannelPreferencesInputSchema,
  setChannelPreferencesOutputSchema,
} from "@mesomed/contracts/communication";
import { authenticatedProcedure } from "../../kernel/authz.js";
import { router } from "../../kernel/trpc.js";
import { registerDeviceToken } from "./commands/register-device-token.js";
import { setChannelPreferences } from "./commands/channel-preferences.js";
import { getChannelPreferences } from "./queries/channel-preferences.js";

export function createCommunicationRouter() {
  return router({
    registerDeviceToken: authenticatedProcedure
      .input(registerDeviceTokenInputSchema)
      .output(registerDeviceTokenOutputSchema)
      .mutation(({ ctx, input }) => registerDeviceToken(ctx.db, ctx.session.userId, input)),

    setChannelPreferences: authenticatedProcedure
      .input(setChannelPreferencesInputSchema)
      .output(setChannelPreferencesOutputSchema)
      .mutation(({ ctx, input }) => setChannelPreferences(ctx.db, ctx.session.userId, input)),

    getChannelPreferences: authenticatedProcedure
      .output(channelPreferencesSchema)
      .query(({ ctx }) => getChannelPreferences(ctx.db, ctx.session.userId)),
  });
}
