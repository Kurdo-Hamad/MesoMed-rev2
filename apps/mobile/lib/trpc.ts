import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@mesomed/api/router";

export const trpc = createTRPCReact<AppRouter>();
