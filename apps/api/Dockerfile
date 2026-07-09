# Pin the exact toolchain the lockfile was written with (MM-QA-001 F-08).
FROM node:22-alpine AS base
RUN npm install -g pnpm@11.10.0 turbo@2.10.4

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
# Production-only dependency tree for the runtime image: first-party code is
# bundled into dist/ by tsup; third-party deps resolve from node_modules, so
# devDependencies must not ship (MM-QA-001 F-08). --legacy because this
# workspace deliberately doesn't use injected packages (hoisted linker,
# ADR-0001 §6).
RUN pnpm --filter=@mesomed/api deploy --prod --legacy /prod/api

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
# dist ships sourcemaps; make production stack traces point at TS sources.
ENV NODE_OPTIONS=--enable-source-maps
RUN addgroup -S mesomed && adduser -S mesomed -G mesomed
COPY --from=installer --chown=mesomed:mesomed /app/apps/api/dist ./dist
COPY --from=installer --chown=mesomed:mesomed /prod/api/node_modules ./node_modules
COPY --from=installer --chown=mesomed:mesomed /prod/api/package.json ./package.json
USER mesomed
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1
CMD ["node", "dist/main.js"]
