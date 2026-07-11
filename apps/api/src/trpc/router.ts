import { healthResponseSchema } from "@mesomed/contracts/health";
import { healthPayload } from "../kernel/health.js";
import { publicProcedure, router } from "../kernel/trpc.js";
import { createBillingRouter } from "../modules/billing/router.js";
import type { PaymentGatewayRegistry } from "../modules/billing/shared.js";
import { createBookingRouter } from "../modules/booking/router.js";
import { createClinicalRouter } from "../modules/clinical/router.js";
import { createCommunicationRouter } from "../modules/communication/router.js";
import { createGuestPatientProfile } from "../modules/identity/commands/create-guest-patient-profile.js";
import { createDirectoryRouter } from "../modules/directory/router.js";
import { createIdentityRouter } from "../modules/identity/router.js";
import type { IdentityModule } from "../modules/identity/index.js";
import { createSchedulingRouter } from "../modules/scheduling/router.js";
import { createSearchRouter } from "../modules/search/router.js";
import { systemRouter } from "./system.js";

const healthRouter = router({
  check: publicProcedure.output(healthResponseSchema).query(() => healthPayload()),
});

/**
 * Root tRPC router. Business modules mount their routers here starting
 * Phase 2 (MM-PLAN-001 §2 — one router per module); it lives outside the
 * kernel because it will depend on module routers, which the kernel must
 * never do.
 */
export function createAppRouter(
  identity: IdentityModule,
  deps: { paymentGateways: PaymentGatewayRegistry },
) {
  return router({
    health: healthRouter,
    system: systemRouter,
    identity: createIdentityRouter(identity.auth),
    directory: createDirectoryRouter(),
    scheduling: createSchedulingRouter(),
    // The guest-profile write is identity code injected at this seam, so
    // booking never value-imports another module's internals (§3.1).
    booking: createBookingRouter({ createGuestPatientProfile }),
    clinical: createClinicalRouter(),
    billing: createBillingRouter({ gateways: deps.paymentGateways }),
    communication: createCommunicationRouter(),
    search: createSearchRouter(),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;
