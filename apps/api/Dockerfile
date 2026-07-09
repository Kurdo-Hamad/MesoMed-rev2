FROM node:22-alpine AS base
RUN npm install -g pnpm@11 turbo@2

FROM base AS pruner
WORKDIR /app
COPY . .
RUN turbo prune @mesomed/api --docker

FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run build --filter=@mesomed/api

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S mesomed && adduser -S mesomed -G mesomed
COPY --from=installer --chown=mesomed:mesomed /app .
USER mesomed
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
