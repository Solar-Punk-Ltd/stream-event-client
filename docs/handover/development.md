# Development

## Run it

You need Node.js 24 or later (`.nvmrc` says 24). pnpm comes through Corepack, at the version `package.json` names.

```bash
corepack enable
pnpm install
pnpm dev
```

The dev server opens at `http://localhost:5173`. Before it shows any streams, fill in `public/config.json`
([configuration](../configuration.md)). The dev server and `pnpm preview` forward `/bee` to a Bee node on this machine,
`http://127.0.0.1:1633`, so a config whose `gatewayUrl` is `/bee` works without the node allowing the page's origin.
Set `DEV_BEE_PROXY_TARGET` to forward it somewhere else (`vite.config.js`).

## The scripts

Every script is in `package.json`. This table is the one place they are listed:

| Script             | What it does                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`         | The Vite dev server                                                                                           |
| `pnpm build`       | `tsc -b` then `vite build` into `dist/`, a static site with `config.json` beside it                           |
| `pnpm preview`     | Serves `dist/` with the same `/bee` proxy                                                                     |
| `pnpm lint`        | oxlint, type-aware                                                                                            |
| `pnpm format`      | oxfmt over the tree. `pnpm format:check` only checks                                                          |
| `pnpm typecheck`   | `tsc --noEmit` for the app and again for `e2e/`                                                               |
| `pnpm test`        | The vitest suites under `test/`                                                                               |
| `pnpm e2e`         | Builds, then the Playwright journeys in `e2e/playwright.config.ts`                                            |
| `pnpm e2e:record`  | Builds, then records the Bee answers the smoke test replays. Needs Docker and ffmpeg                          |
| `pnpm proof:weeb3` | Builds, then the live proof of weeb-3 on the public network. Never in CI                                      |
| `pnpm test:image`  | Builds the Docker image and checks it running in both modes. Needs a Docker daemon                            |
| `pnpm test:docker` | `test:image`, then `e2e:record` with the browser's system libraries installed, for a job with a Docker daemon |

## Tests

**Unit tests** (`pnpm test`, vitest, `vitest.config.ts`) live under `test/`, by feature in `chat/`, `connect/`,
`gateway/`, `following/`, `swarm/` and `shared/`, with the player's and the catalog's at the top level. `test/helpers/`
holds the doubles: `scriptedProvider.ts` (a provider that answers what a test says), `recordedBeeGateway.ts`,
`gatewaySwarm.ts`, `fakeSwarmChat.ts`, `fakeSwarmId.ts`, `fakeWeeb3.ts`, `connectPage.ts` and the rest.
`test/feedModel/` simulates a Bee node, a publisher and a player on virtual time, and `study.test.ts` and
`recommendedPair.test.ts` there measure the feed-following strategies on it. The environment is node, and a component
test asks for jsdom in its own docblock. The timeout is a 30 s backstop, not a margin anything relies on.

Five suites guard the whole repository rather than one feature:

- `test/swarm/boundary.test.ts`: the Swarm layer imports nothing from the app or the features, and they reach Swarm
  only through the client ([architecture](architecture.md#the-import-direction-and-the-boundary-test)).
- `test/designTokens.test.ts`: every theme defines every variable, no raw colour outside `src/design/`, text contrast
  at least 4.5:1.
- `test/unusedExports.test.ts`: the count of exports nothing else imports stays at or below
  `scripts/unused-exports-baseline.json`. `node scripts/unused-exports.mjs --list` names them, and after removing one,
  `node scripts/unused-exports.mjs --write` lowers the baseline so the gain is kept. The ratchet keeps new API private
  until something uses it.
- `test/bundle.test.ts`: the emitted bundle honours the browser target `vite.config.js` declares, so no media-query
  range syntax and nothing past es2020 reaches an older engine.
- `test/noUnboundedFetch.test.ts`: no file under `src/` calls the global `fetch` unbounded.

**Browser journeys** (`pnpm e2e`, Playwright 1.63, `e2e/playwright.config.ts`) run the built app in one real Chromium,
one worker, with no node and no network:

- `smoke.e2e.ts` replays the recorded Bee answers in `e2e/recorded/viewer.har` and the files beside it.
- `theme.e2e.ts` switches the theme on that recording.
- `chatStamp.e2e.ts` sends messages on the viewer's own stamp against a fake Swarm ID site (`fakeSwarmIdSite.ts`),
  through a Bee node and through a fake Weeb3 (`fakeWeeb3.ts`), signing in and changing the stamp through that site's
  button frame.
- `ladder.e2e.ts`, `connect.e2e.ts` and `weeb3.e2e.ts` run real hls.js against a fake gateway (`ladderGateway.ts`)
  publishing a live stream in four qualities, each answer held back 650 ms.
- `weeb3Worker.e2e.ts` starts the real weeb-3 package and checks that its root worker takes control of the page, once
  on a host that sends no headers (`staticSite.ts`, the built app served as an ENS gateway serves it) and once with
  weeb-3's own worker already registered for the whole site, as an earlier version left it.

`installBrowser.ts` fetches the pinned Chromium headless shell before the first run, and the system libraries with it
when `CI` or `PLAYWRIGHT_INSTALL_DEPS` is set. The journeys print their timings and read rates without asserting them.

**The recorder** (`pnpm e2e:record`, `e2e/record.config.ts`, `e2e/record.e2e.ts`) starts a Bee node on a local chain
through Docker (`e2e/record/`), publishes a stream and a chat, and records the browser's answers into
`test-results/recorded/`. Nothing it records reaches the tree on its own: the smoke test replays only what is committed
under `e2e/recorded/`.

**The live proof** (`pnpm proof:weeb3`, `e2e/weeb3-live.config.ts`, `e2e/weeb3Live.proof.ts`) runs the real weeb-3
package against the public Swarm network, as [weeb-3](../weeb3.md) says. It is opt-in and never part of CI.

**The image** (`pnpm test:image`, `test/docker/image.docker.mjs`, `node --test`) builds and runs the image in both
modes, as [the image](../image.md#testing-the-image) says. `test/image.test.ts` runs the start script alone, without
Docker, under `pnpm test`.

## First-load size

`node scripts/first-load-size.mjs dist` prints the raw and gzip size of the JS and CSS the built `index.html`
references, and appends it to the job summary in CI. It reports and never fails.

## The build label

`scripts/build-label.mjs` names the build for Copy diagnostics and the quality panel: `BUILD_TAG` and `BUILD_COMMIT`
from the environment when the image workflow sets them, else git's tag or nearest tag and commit with `-dirty`, else
`development build`. `vite.config.js` defines it as `__BUILD_LABEL__`, and `src/shared/buildLabel.ts` reads it, or
`unbundled` outside a build. The rule in full is in [the image](../image.md#the-release-tag-and-the-build-label).

## weeb-3's files

`scripts/weeb3-files.mjs` is a Vite plugin that copies the weeb-3 package's browser files, its service worker, shared
worker and WebAssembly module, to `/weeb-3/` in the build, writes the root worker `/weeb-3-host.js` that loads the
service worker (`src/swarm/providers/weeb-3/weeb3HostWorker.ts` registers it), serves both from the dev server,
defines `__WEEB3_VERSION__`, and points the package's own import of hls.js at `src/swarm/providers/weeb-3/weeb3Hls.ts`,
the stoppable copy.

## Dependencies

`pnpm-workspace.yaml` holds pnpm's settings:

- Every dependency is pinned to an exact version (`saveExact: true`).
- No version younger than a week is installed, transitive ones included (`minimumReleaseAge: 10080`, in minutes, with
  `minimumReleaseAgeStrict: true`, so an install fails rather than fall back to an older version).
- Three packages are exempt from that age, each at one exact version (`minimumReleaseAgeExclude`):
  `@solarpunkltd/swarm-chat-js`, `@solarpunkltd/swarm-id` and `@lat-murmeldjur/weeb_3`. The file says what was
  checked on each before it was let in.
- No install script runs for `@parcel/watcher` or `@swc/core` (`allowBuilds`). Both are optional native helpers.
- `overrides` carries minimum versions for `immutable`, `nanoid@3`, `postcss` and `ws`, each a package with a
  published security fix.

## The image and nginx

`Dockerfile` builds `dist/` on node 24 and serves it with nginx, both pinned by digest. `deploy/nginx/default.conf` is
the server, and `deploy/nginx/40-gateway-and-policy.sh` runs at start and writes the gateway proxy, the headers and the
font CORS from the image's settings. Everything about running it is in [the image](../image.md).

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and every push to `main`: `pnpm install --frozen-lockfile`,
`format:check`, `lint`, `typecheck`, `test`, `build`, the first-load size report, and `pnpm e2e`, keeping
`test-results/` for seven days when the browser run fails. Actions are pinned by commit.

## Releases

`.github/workflows/image.yml` runs on a `v*` tag: it builds the image for `linux/amd64` and pushes it as
`ghcr.io/solar-punk-ltd/stream-event-client:<tag>`, passing the tag and its commit in as `BUILD_TAG` and
`BUILD_COMMIT`. `latest` is never written, so a deployment pins the digest the tag resolves to. Releases are tagged by
the maintainers.

## Working here

The repository's rules are in `AGENTS.md`: no real host names, addresses, keys or stamp ids in the tree, a setting in
the runtime config for anything that differs between deployments, a bug gets its own pull request with a test that
fails before the fix, a behaviour change updates the page that describes it in the same pull request, timings are
reported and never asserted, and a comment carries context the code cannot.
