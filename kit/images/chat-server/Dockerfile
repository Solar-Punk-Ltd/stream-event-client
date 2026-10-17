# The chat server at the commit kit.lock.json pins, built as its own Dockerfile builds it, with the chat library the
# kit packed installed over the version its lockfile names. The build context is the kit's packed libraries. The
# source is fetched by commit, so a moved branch cannot change what runs.
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS builder
RUN apk add --no-cache git
ARG CHAT_SERVER_REPO
ARG CHAT_SERVER_COMMIT
WORKDIR /app
RUN git init -q . && git remote add origin "$CHAT_SERVER_REPO" && git fetch -q --depth 1 origin "$CHAT_SERVER_COMMIT" \
  && git checkout -q FETCH_HEAD && test "$(git rev-parse HEAD)" = "$CHAT_SERVER_COMMIT" && rm -rf .git
RUN corepack enable && pnpm install --frozen-lockfile
COPY . /libraries/
RUN node /libraries/install.mjs
RUN pnpm build && pnpm prune --prod --ignore-scripts

FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
RUN addgroup -g 1001 -S nodejs && adduser -S aggregator -u 1001 -G nodejs && mkdir -p /app/checkpoints \
  && chown -R aggregator:nodejs /app/checkpoints
USER aggregator
ENV CHECKPOINT_DIR=/app/checkpoints
VOLUME ["/app/checkpoints"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.HEALTH_PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dist/index.js"]
