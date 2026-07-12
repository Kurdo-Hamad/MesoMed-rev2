# Pin the exact toolchain the lockfile was written with (MM-QA-001 F-08).
FROM node:22-alpine AS base
RUN npm install -g pnpm@11.10.0 turbo@2.10.4

FROM base AS pruner
WORKDIR /app
COPY . .
RUN turbo prune @mesomed/web --docker

FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
# NEXT_PUBLIC_* values are inlined into client bundles at BUILD time — pass
# the deployment's public API origin here; runtime env cannot change them.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_MEDIA_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_MEDIA_URL=$NEXT_PUBLIC_MEDIA_URL
RUN pnpm turbo run build --filter=@mesomed/web
RUN pnpm --filter=@mesomed/web deploy --prod --legacy /prod/web

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup -S mesomed && adduser -S mesomed -G mesomed
COPY --from=installer --chown=mesomed:mesomed /app/apps/web/.next ./.next
COPY --from=installer --chown=mesomed:mesomed /app/apps/web/public ./public
COPY --from=installer --chown=mesomed:mesomed /app/apps/web/next.config.ts ./next.config.ts
COPY --from=installer --chown=mesomed:mesomed /prod/web/node_modules ./node_modules
COPY --from=installer --chown=mesomed:mesomed /prod/web/package.json ./package.json
USER mesomed
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/en" >/dev/null || exit 1
CMD ["./node_modules/.bin/next", "start"]
