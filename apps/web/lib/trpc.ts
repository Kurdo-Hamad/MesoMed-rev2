import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@mesomed/api/router";

export const trpc: ReturnType<typeof createTRPCReact<AppRouter>> = createTRPCReact<AppRouter>();
