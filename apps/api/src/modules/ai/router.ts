/**
 * AI tRPC surface (MM-PLAN-001 §5 Phase 7). Public — symptom triage
 * doesn't require an account (a guest exploring the app before booking is
 * the primary use case) — but is gated by two independent rate limits so
 * an unauthenticated procedure can't become an open model-spend faucet:
 * a per-caller bucket (session user, else IP) and a separate global
 * bucket, checked in that order, each with its own typed error.
 */
import { resolveAiTriageRatePolicy } from "@mesomed/config";
import { checkRateLimit } from "@mesomed/domain/ai";
import { triageInputSchema, triageOutputSchema } from "@mesomed/contracts/ai";
import { ErrorCode } from "@mesomed/contracts/errors";
import type { AiGateway } from "@mesomed/platform";
import { AppError } from "../../kernel/errors.js";
import { publicProcedure, router } from "../../kernel/trpc.js";
import { createTriageService } from "./triage-service.js";

export function createAiRouter(deps: { ai: AiGateway }) {
  return router({
    triageSymptoms: publicProcedure
      .input(triageInputSchema)
      .output(triageOutputSchema)
      .mutation(async ({ ctx, input }) => {
        const now = Date.now();
        const policy = await resolveAiTriageRatePolicy(ctx.config);
        const callerKey = ctx.session?.userId ?? ctx.req.ip;

        if (!checkRateLimit(`ai.triage.caller:${callerKey}`, policy.perCaller, now)) {
          throw new AppError(ErrorCode.RATE_LIMITED, "Too many triage requests from this caller");
        }
        if (!checkRateLimit("ai.triage.global", policy.global, now)) {
          throw new AppError(ErrorCode.AI_QUOTA_EXCEEDED, "Triage capacity exceeded — try again shortly");
        }

        const service = createTriageService({ db: ctx.db, ai: deps.ai, log: ctx.req.log });
        return service.triageSymptoms(input.text);
      }),
  });
}
