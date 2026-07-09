import { initTRPC } from "@trpc/server";
import { AppError, ErrorCode } from "@mesomed/contracts/errors";
import type { Context } from "./context.js";

/** Typed error codes per MM-PLAN-001 §3.11 — clients switch on `data.code`, never messages. */
const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    const cause = error.cause;
    return {
      ...shape,
      data: {
        ...shape.data,
        code: cause instanceof AppError ? cause.code : ErrorCode.INTERNAL,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
