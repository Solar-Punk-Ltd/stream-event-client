# One library packed from its repository at the commit kit.lock.json pins, as `npm publish` would pack it, so the
# viewer and the chat server can be built against a release before it is published. The kit exports the one tarball
# this builds with `docker build --output`. The source is fetched by commit, so a moved branch cannot change it.
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS pack
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
ARG LIBRARY_REPO
ARG LIBRARY_COMMIT
ARG LIBRARY_DIR=.
WORKDIR /src
RUN git init -q . && git remote add origin "$LIBRARY_REPO" && git fetch -q --depth 1 origin "$LIBRARY_COMMIT" \
  && git checkout -q FETCH_HEAD && test "$(git rev-parse HEAD)" = "$LIBRARY_COMMIT"
RUN corepack enable && pnpm install --frozen-lockfile
RUN cd "$LIBRARY_DIR" && pnpm run build && pnpm pack --pack-destination /out

FROM scratch
COPY --from=pack /out /
