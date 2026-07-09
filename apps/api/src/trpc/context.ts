import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";

export function createContext({ req }: CreateFastifyContextOptions) {
  return { requestId: req.id };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
