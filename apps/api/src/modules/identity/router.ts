/**
 * Identity module tRPC surface. Signup/login/OTP/verification live on
 * Better Auth's own /api/auth/* endpoints; these procedures cover the
 * module's domain commands and queries, each I/O-typed by the contracts
 * package (§3.11/§3.12) and role-guarded by the kernel authz middleware
 * (§3.6 layer a) with ownership checks inside handlers (layer b).
 */
import { fromNodeHeaders } from "better-auth/node";
import { ErrorCode } from "@mesomed/contracts/errors";
import {
  claimProfileInputSchema,
  claimProfileOutputSchema,
  completeProviderSignupInputSchema,
  completeProviderSignupOutputSchema,
  listPendingProvidersOutputSchema,
  meResponseSchema,
  providerStatusResponseSchema,
  recoverProviderAccountInputSchema,
  recoverProviderAccountOutputSchema,
  revokeOtherSessionsOutputSchema,
  setProviderStatusInputSchema,
  setProviderStatusOutputSchema,
  type ClaimProof,
} from "@mesomed/contracts/identity";
import { isPlaceholderEmail, normalizePhone } from "@mesomed/domain/identity";
import { eq, patientProfiles, providerProfiles, user } from "@mesomed/db";
import { authenticatedProcedure, roleProcedure } from "../../kernel/authz.js";
import { AppError } from "../../kernel/errors.js";
import { router } from "../../kernel/trpc.js";
import type { IdentityAuth } from "./auth.js";
import { claimPatientProfile } from "./commands/claim-patient-profile.js";
import { completeProviderSignup } from "./commands/complete-provider-signup.js";
import { ensurePatientRegistration } from "./commands/ensure-patient-registration.js";
import { recoverProviderAccount } from "./commands/recover-provider-account.js";
import { setProviderStatus } from "./commands/set-provider-status.js";

export function createIdentityRouter(auth: IdentityAuth) {
  return router({
    me: authenticatedProcedure.output(meResponseSchema).query(async ({ ctx }) => {
      const userId = ctx.session.userId;
      const [account] = await ctx.db.select().from(user).where(eq(user.id, userId));
      if (!account) throw new AppError(ErrorCode.NOT_FOUND, "User not found");
      const [patientProfile] = await ctx.db
        .select({ id: patientProfiles.id, fullName: patientProfiles.fullName })
        .from(patientProfiles)
        .where(eq(patientProfiles.userId, userId));
      const [providerProfile] = await ctx.db
        .select({
          providerProfileId: providerProfiles.id,
          providerType: providerProfiles.providerType,
          status: providerProfiles.status,
          rejectionReason: providerProfiles.rejectionReason,
        })
        .from(providerProfiles)
        .where(eq(providerProfiles.userId, userId));
      return {
        userId,
        roles: [...ctx.session.roles],
        phone: account.phoneNumber ?? null,
        email: isPlaceholderEmail(account.email) ? null : account.email,
        patientProfile: patientProfile ?? null,
        providerProfile: providerProfile ?? null,
      };
    }),

    claimProfile: authenticatedProcedure
      .input(claimProfileInputSchema)
      .output(claimProfileOutputSchema)
      .mutation(async ({ ctx, input }) => {
        const normalized = normalizePhone(input.phone);
        if (normalized === null) {
          throw new AppError(ErrorCode.VALIDATION, "Invalid phone number");
        }
        const userId = ctx.session.userId;
        return ctx.db.transaction(async (tx) => {
          const [account] = await tx.select().from(user).where(eq(user.id, userId));
          if (!account) throw new AppError(ErrorCode.NOT_FOUND, "User not found");

          // Ownership proof, established server-side only (convention #7):
          // (a) the caller's OTP-verified phone matches, or (b) the caller's
          // verified email matches the email on the guest profile.
          let proof: ClaimProof = "otp-verified-phone";
          let proofVerified =
            account.phoneNumber === normalized && account.phoneNumberVerified === true;
          if (!proofVerified && account.emailVerified && !isPlaceholderEmail(account.email)) {
            const [guest] = await tx
              .select({ email: patientProfiles.email })
              .from(patientProfiles)
              .where(eq(patientProfiles.normalizedPhone, normalized));
            if (guest?.email && guest.email.toLowerCase() === account.email.toLowerCase()) {
              proof = "verified-email";
              proofVerified = true;
            }
          }

          if (proofVerified) {
            await ensurePatientRegistration(tx, ctx.outbox, { userId });
          }

          const result = await claimPatientProfile(tx, ctx.outbox, {
            userId,
            normalizedPhone: normalized,
            proof,
            proofVerified,
            fullNameFallback: account.name,
          });
          return { profileId: result.profileId, proof };
        });
      }),

    completeProviderSignup: authenticatedProcedure
      .input(completeProviderSignupInputSchema)
      .output(completeProviderSignupOutputSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) =>
          completeProviderSignup(tx, ctx.outbox, {
            userId: ctx.session.userId,
            providerType: input.providerType,
            phone: input.phone,
          }),
        ),
      ),

    myProviderStatus: roleProcedure("doctor", "secretary")
      .output(providerStatusResponseSchema)
      .query(async ({ ctx }) => {
        const [profile] = await ctx.db
          .select({
            providerProfileId: providerProfiles.id,
            providerType: providerProfiles.providerType,
            status: providerProfiles.status,
            rejectionReason: providerProfiles.rejectionReason,
          })
          .from(providerProfiles)
          .where(eq(providerProfiles.userId, ctx.session.userId));
        if (!profile) throw new AppError(ErrorCode.NOT_FOUND, "No provider profile");
        return profile;
      }),

    listPendingProviders: roleProcedure("admin")
      .output(listPendingProvidersOutputSchema)
      .query(async ({ ctx }) => {
        const rows = await ctx.db
          .select({
            providerProfileId: providerProfiles.id,
            userId: providerProfiles.userId,
            providerType: providerProfiles.providerType,
            email: user.email,
            phone: providerProfiles.phone,
            createdAt: providerProfiles.createdAt,
          })
          .from(providerProfiles)
          .innerJoin(user, eq(user.id, providerProfiles.userId))
          .where(eq(providerProfiles.status, "pending"));
        return rows.map((row) => ({
          ...row,
          email: isPlaceholderEmail(row.email) ? null : row.email,
          createdAt: row.createdAt.toISOString(),
        }));
      }),

    setProviderStatus: roleProcedure("admin")
      .input(setProviderStatusInputSchema)
      .output(setProviderStatusOutputSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) =>
          setProviderStatus(tx, ctx.outbox, { ...input, changedBy: ctx.session.userId }),
        ),
      ),

    recoverProviderAccount: roleProcedure("admin")
      .input(recoverProviderAccountInputSchema)
      .output(recoverProviderAccountOutputSchema)
      .mutation(({ ctx, input }) =>
        recoverProviderAccount(
          { db: ctx.db, outbox: ctx.outbox, auth },
          { ...input, recoveredBy: ctx.session.userId },
        ),
      ),

    revokeOtherSessions: authenticatedProcedure
      .output(revokeOtherSessionsOutputSchema)
      .mutation(async ({ ctx }) => {
        const result = await auth.api.revokeOtherSessions({
          headers: fromNodeHeaders(ctx.req.headers),
        });
        return { revoked: result.status === true };
      }),
  });
}
