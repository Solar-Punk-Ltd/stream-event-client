# The Solar Punk fork of Swarm ID at the commit kit.lock.json pins, as its own browser suites run it: the identity UI
# on its development server and the account-bus signaling server, from one image. A development build serves the
# origins named in PUBLIC_SITE_ALLOW_LIST_DEV_ORIGINS without reading the allow list from ENS, which is how the kit
# admits the local viewer. The source is fetched by commit, so a moved branch cannot change what runs.
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
ARG SWARM_ID_REPO
ARG SWARM_ID_COMMIT
WORKDIR /src
RUN git init -q . && git remote add origin "$SWARM_ID_REPO" && git fetch -q --depth 1 origin "$SWARM_ID_COMMIT" \
  && git checkout -q FETCH_HEAD && test "$(git rev-parse HEAD)" = "$SWARM_ID_COMMIT"
RUN corepack enable && pnpm install --frozen-lockfile
ENV PORT=5520
EXPOSE 5500 5520
CMD ["pnpm", "--filter", "@swarm-id/ui", "exec", "vite", "dev", "--host", "0.0.0.0", "--port", "5500", "--strictPort"]
