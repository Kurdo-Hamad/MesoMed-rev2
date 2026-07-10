/**
 * Mounts Better Auth's HTTP surface on Fastify at /api/auth/* using the
 * documented request-conversion pattern (Fastify has parsed the body, so
 * it is re-serialized for the fetch Request).
 */
import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import type { IdentityAuth } from "./auth.js";

export function registerAuthRoutes(app: FastifyInstance, auth: IdentityAuth): void {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      const headers = fromNodeHeaders(request.headers);
      const req = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(request.body !== undefined && request.body !== null
          ? { body: JSON.stringify(request.body) }
          : {}),
      });
      const response = await auth.handler(req);
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        reply.header(key, value);
      });
      return reply.send(response.body ? await response.text() : null);
    },
  });
}
