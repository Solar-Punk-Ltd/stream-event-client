# stream-event-client

A lightweight web app for watching the Devcon 8 streams over [Swarm](https://www.ethswarm.org):
browse the event's streams, watch one, choose where the video loads from (the event gateway or your
own Bee node), and chat with the other people watching.

**Status: phase 3 of the plan, the chat.** The stream list, the watch page, the player and the Bee
node picker work, in the Swarm Brand v3.0 look, and each stream has a chat beside the video, built and
tested against stand-ins until the chat's services are set up. The plan, its phases and its decisions
are in [docs/PLAN.md](docs/PLAN.md).

It is built from the viewer of
[streaming-monorepo](https://github.com/Solar-Punk-Ltd/streaming-monorepo) and the Swarm design and
chat of [msrs-client](https://github.com/Solar-Punk-Ltd/msrs-client).

## Run it

You need Node.js 24 or later. pnpm comes through Corepack, at the version `package.json` names.

```bash
corepack enable
pnpm install
pnpm dev
```

The dev server opens at `http://localhost:5173`. Before it shows any streams, fill in
`public/config.json` (see below).

The dev server and `pnpm preview` forward `/bee` to a Bee node on this machine,
`http://127.0.0.1:1633`, so a config whose `gatewayUrl` is `/bee` works without the node allowing the
page's origin. Set `DEV_BEE_PROXY_TARGET` to forward it somewhere else.

## Configure it

Every setting is read from `config.json`, served beside the page, when the app starts. One build
serves every deployment, and a setting changes without a rebuild. A page that cannot read its config,
or finds a value it refuses, says which field is wrong instead of showing an empty list.

The repository's `public/config.json` is an example with placeholders. The page refuses to start on
a value still in `<angle brackets>`, so the example can never pass for a real deployment. Real values
live with the deployment, never in this repository.

| Field           | What it is                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gatewayUrl`    | The event gateway: a path on this site such as `/bee`, which the site proxies to Bee, or an http or https address of a Bee node. Set this or `providers`, not both |
| `providers`     | Optional in place of `gatewayUrl`. The gateways offered, the default, the fallback and the kinds offered, below                                                    |
| `catalog.owner` | The Ethereum address that owns the stream list feed                                                                                                                |
| `catalog.topic` | The stream list feed's topic, as text                                                                                                                              |
| `chat`          | Optional. The chat's settings, below. Without it, or with `enabled` false, there is no chat anywhere on the page                                                   |
| `theme`         | Optional. Which of the build's themes the page wears, `swarm` by default. A name the build does not carry is refused                                               |

A theme is a set of colours and typefaces in `src/design/themes/`, with its logo, page copy and
footer links in `src/design/themes.ts`. Every theme defines the same variables, so a deployment that picks another
theme leaves nothing unset, and the tokens test fails on a theme that misses one or on a text colour below 4.5:1.

The `chat` block. With `enabled` true every field must be filled in, and the page refuses to start
otherwise. With `enabled` false the other fields are not read.

| Field                 | What it is                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat.enabled`        | Whether the page has a chat                                                                                                                                      |
| `chat.readUrl`        | Where the chat's feed and history files are read: a path on this site or an http or https address                                                                |
| `chat.writeUrl`       | Where chat messages are written, an endpoint that stamps each write: a path on this site or an http or https address. The one `chat.beeUrl` of before is refused |
| `chat.gsocResourceId` | 32 bytes as 64 hex digits: the key every viewer writes chat messages with. Shared by design and public, not a secret (below)                                     |
| `chat.gsocTopic`      | The topic of the address the chat aggregator listens on                                                                                                          |
| `chat.feedOwner`      | The Ethereum address that writes the chat feeds, which is the aggregator's                                                                                       |
| `chat.pollIntervalMs` | How often an open chat reads its feed, in milliseconds. A positive whole number, raised under load without a rebuild                                             |

The `providers` block names more than one way of reaching Swarm. A config that names only `gatewayUrl` is
read as one Bee gateway, the default and the fallback, so a deployment written before `providers` needs no
change. The fallback is on by default: a viewer who picks another gateway or a node of their own reads from
it with the fallback behind it, which is the default gateway unless the config names another, and a viewer
who picks the named fallback itself has the default behind them. The chat reads from `chat.readUrl` whatever the viewer picks.

| Field                       | What it is                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `providers.gateways`        | The gateways offered, at least one. Each has an `id`, a `kind`, an optional `label` and its own settings                       |
| `providers.gateways[].kind` | `bee-http`, a Bee node's HTTP API, the only kind this build carries. A kind the build does not carry is refused                |
| `providers.gateways[].url`  | For `bee-http`: a path on this site such as `/bee`, or an http or https address, as `gatewayUrl` takes                         |
| `providers.default`         | The `id` of the gateway every reader starts on                                                                                 |
| `providers.fallback`        | Optional. The `id` of another gateway, asked when the one in use fails. The default gateway when absent, and none when `false` |
| `providers.kinds`           | Optional. The kinds a viewer may add a gateway of their own of. Every kind the build carries when absent                       |

Serve `config.json` with `Cache-Control: no-store`, so a changed setting reaches every page opened
after the change.

## The chat

One chat per stream, beside the video on a desktop and under it on a phone, where it folds away.
Anyone can read it. Writing asks once for a display name, 1 to 20 characters, and there is no
password, wallet or account. A viewer can send a message, react with an emoji, reply in a thread,
load older messages, and retry a message that did not send. The chat and its library are a file of
the bundle of their own, fetched as the watch page opens, beside the video rather than after it, and
the emoji picker is fetched the first time it opens.

**What it needs, outside this repository.** Two services, set up apart from this app:

- **Two Bee endpoints for the chat.** `chat.readUrl` serves the chat's feed and history files.
  `chat.writeUrl` takes the messages and stamps every write, because the page holds no postage stamp.
  A message costs one stamped chunk, and one more for each resend while it has not been read back.
- **The chat aggregator**, which listens on the shared address the key and topic above name, and
  appends each message to the stream's chat feed, `chat-<stream topic>` under `chat.feedOwner`.
  Opening a chat reads the newest history file the chat feed points to, then the entries after it. The endpoint viewers write
  through must be a different Bee node from the one the aggregator listens on, because Bee hands a
  message on to a listener only when it arrives from another node.

**Why `gsocResourceId` is not a secret.** Every viewer writes to the same shared address, so every
viewer's page carries the same key. It is chosen so the address lands where the aggregator listens,
and it owns nothing but that shared chat address, which every viewer writes to anyway. A check for
keys in the tree has to know it.

**What the browser keeps.** The display name, the chat key made for it (32 random bytes from the
browser's own crypto) and its address sit in local storage under `stream-event-client:chat-session`,
so a reload keeps the name. Logging out removes them. The key proves only that two messages came from
the same browser, and anyone may choose any name. So each message shows its sender's initial, and the
name with the last six digits of the sender's address shows on hover or focus and is what a screen
reader reads.

## Build it

```bash
pnpm build     # typecheck and bundle into dist/
pnpm preview   # serve dist/ locally
```

`dist/` is a static site. Serve it with a fallback to `index.html` and with its `config.json` beside
it, or run the image below, which does both.

The other scripts: `pnpm test` (vitest), `pnpm lint` (oxlint), `pnpm typecheck`, `pnpm format` and
`pnpm format:check` (oxfmt). `pnpm e2e` builds the app and runs the browser journeys in Playwright:
a replayed recording, and real hls.js against a fake gateway publishing a live stream in four
qualities, each answer held back 650 ms. The first run downloads the Chromium build Playwright pins.
Beyond that they need no Bee node and no network, and they print their timings and read rates
without asserting them. Continuous integration runs the format check, lint, typecheck, tests and
build on every pull request, and reports what the first page load downloads.

## Run the image

The `Dockerfile` builds one image for every deployment: nginx serving the built page, with the page
fallback, and the gateway at `/bee` when it is proxied. What a deployment differs by is read when the
container starts.

```bash
docker build -t stream-event-client .
docker run -p 8080:80 \
  -e BEE_GATEWAY_URL=https://gateway.example.com \
  -e CHAT_READ_URL=https://chat-read.example.com \
  -e CHAT_WRITE_URL=https://chat-write.example.com \
  -v "$PWD/config.json:/usr/share/nginx/html/config.json:ro" \
  stream-event-client
```

| Setting           | What it is                                                                                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GATEWAY_MODE`    | `proxy`, the default: the page reads the gateway at `/bee` on its own origin, so `config.json` names `/bee` as `gatewayUrl`. `direct`: the page reads the gateway at its own address, which `config.json` names |
| `BEE_GATEWAY_URL` | Required. The gateway's address, with no path. In proxy mode `/bee` forwards to it. In direct mode the page is allowed to reach it                                                                              |
| `CHAT_READ_URL`   | The chat's read endpoint, the same as `chat.readUrl` in `config.json`, which the page is then allowed to reach. Leave it out when there is no chat                                                              |
| `CHAT_WRITE_URL`  | The chat's write endpoint, the same as `chat.writeUrl`, allowed the same way. The one `CHAT_BEE_URL` of before stops the container                                                                              |
| `config.json`     | Mounted over the image's example at `/usr/share/nginx/html/config.json`. Without it the page shows the example's placeholders as a configuration problem                                                        |

A setting that is missing or malformed stops the container at start, and its log says which one.

A `v*` tag publishes the image, built for amd64, as `ghcr.io/solar-punk-ltd/stream-event-client:<tag>`
(`.github/workflows/image.yml`). A deployment pins it by the digest that tag resolves to. No tag ever
moves `latest`.

`pnpm test:image` builds the image and checks it running, in both modes: `nginx -t`, the cache
headers and the policy on each kind of answer, reads and refused writes at `/bee`, and the refusal to
start without `BEE_GATEWAY_URL`. It needs a Docker daemon, so it is not part of `pnpm test`. `pnpm test:docker` runs it and then
records the browser smoke test's answers, which is what a job with a Docker daemon runs.

- **Caching.** The page is served `no-cache`, so a browser asks before reusing it after a deploy.
  `config.json` is served `no-store`. The bundle under `/assets/` is named by content hash and kept
  for a year.
- **Content security policy.** The page may reach its own origin, the gateway in direct mode, the chat
  endpoint, and a Bee node on the viewer's own machine at any port, which is what the node picker
  offers. Inline styles are allowed because the emoji picker writes its own, and blob URLs because the
  player plays through them.
- **The proxy passes reads only.** `/bee` forwards `GET` and `HEAD`, so the site cannot be used to
  write to the gateway. The chat writes through its own endpoint, `CHAT_WRITE_URL`.

## What the viewer does

- **The stream list.** Read from a Swarm feed and read again every 5 seconds. Every live stream gets
  a featured block of its own, then the next upcoming stream, the soonest whose start is still ahead,
  gets one with a countdown in days, hours and minutes. The other upcoming streams follow as cards
  with the soonest start first, then the past streams newest first, eight to a page. The clock is
  read every 30 seconds, so a page left open moves its countdown and its feature on. A read from a
  newer feed slot replaces the list whatever changed in it, so an entry edited, unpublished or gone
  live in place shows on an open page without a reload.
- **Search.** The box above the list matches a stream's title, description and tags as the viewer
  types. While it holds a query the matches are one flat list, paged the same way, and a query that
  matches nothing says so.
- **Previews.** The entry's uploaded thumbnail when it has one, otherwise a frame decoded from the
  stream's first segment, with a live badge and the duration.
- **Scheduled streams.** An entry whose state is `scheduled` has been announced and not yet
  broadcast. Its watch page says the stream has not started, keeps reading the stream list, and starts
  the player as soon as the entry turns live. If it is unpublished while the page waits, the page says
  it is no longer available.
- **A broadcast that comes back.** After a feed finishes, the player keeps asking for the slot after
  the finished playlist, about every 30 seconds and spread per viewer. When the broadcast returns and
  the viewer has reached the end of what they were playing, the player rejoins it live.
- **The quality ladder.** A stream published in several qualities is one feed per quality plus a
  master playlist on a feed of its own. When the stream list names the stream's renditions, the
  player builds the master from the list and never reads the master feed. hls.js chooses the
  quality, and the player reads only the feed of the quality it plays.
- **How it times its reads.** The player asks for the next playlist when it is due: the newest
  segment's end, plus one segment, plus a delay it learns from its own reads, set so that about one
  ask in four comes too early. A second ask covers that one, then one ask per segment, then asks
  every 2 seconds rising to 4 while nothing comes. A playlist 4 seconds late is looked past, one
  slot further on. One viewer costs about 40 reads a minute.
- **How it finds the newest playlist.** It reads slots by their number, never Bee's feed lookup.
  The uploader writes a time marker for each stream every 10 seconds, at an address worked out from
  the clock, naming every quality's newest playlist. At the start, at a switch, and when a quality
  stops or finishes, the player reads the marker of the previous 10 seconds, and the one before if
  that is missing, then one round of eight slots from where it says. One marker read serves every
  quality for a few seconds, and a marker address found missing is never asked again. The clock is
  the gateway's, taken from the `Date` header of every answer the Swarm client reads for the player and the stream list, so a viewer whose
  clock is wrong still finds the marker. With no marker, it searches as before: at the start eight slots at once,
  spread out to the feed's length, closing in on the newest in a few rounds, and at a switch from
  the playing quality's newest slot, usually one round. The new quality is read further back when the
  viewer is behind the live edge, at most ten reads, and the old one stops being read once hls.js has
  switched. When hls.js goes back to the old one before the new one plays, the new one stops instead.
  A switch asked before hls.js has reported its first quality is kept.
- **A quality that stops.** A quality is judged by its own progress, never by comparing it with
  another, because the qualities' feeds drift apart. A switch to a quality that has finished while
  the playing one is live, or sits more than 30 seconds behind it, is refused. When the playing
  quality has had nothing new for 8 seconds, or finishes, the next lower quality is found and then
  read for 6 seconds: if it moves on, the player moves to it and drops the stopped one. There is no limit
  on how many are dropped: a quality refused at a switch is dropped too, and the player keeps moving on
  until it is on a quality that moves. The last quality is never dropped. If the next one does not move
  on, the broadcast paused or ended, and the player says so.
- **The end.** The qualities of one broadcast finish moments apart, each as its upload drains. So
  when the playing quality finishes, the next lower one is watched for the whole 6 seconds rather than
  to its first new playlist: one that finishes inside them means the broadcast ended, and only one
  that carries on through them is moved to. A quality the player was moved to that finishes before
  hls.js has switched to it runs the same check.
- **Where the video loads from.** The Bee node picker offers the event gateway and a Bee node on the
  viewer's own computer, `http://localhost:1633` filled in and the port editable. Only `localhost`,
  `127.0.0.1` and `[::1]` are accepted. The node is checked before the switch through its provider's
  probe, a failure is explained in plain words, and the choice is remembered in the browser. A switch
  makes the Swarm client again on that node, and the player, the stream list and the previews read
  through it from then on.
- **Diagnosing playback.** `?qoe=1` on a watch page shows a draggable playback quality overlay,
  toggled with `Q`. `?level=720p` pins one quality, which tells a bad quality apart from a bad switch.

## How the player reads Swarm

hls.js expects playlists at fixed URLs. On Swarm every playlist update is new content under a feed,
so the player brings its own loaders:

- **CustomManifestLoader** reads the latest playlist from its feed instead of a fixed URL. Every feed
  read the player makes goes through the Swarm client's player reader, which `AppProvider` hands the
  shared `ManifestFetcher` at start and on every node switch (`useSwarm`). Not found is a slot not
  written yet, and anything else is the gateway failing, backed off as before, a rate limit for at
  least as long as it asked.
- **CustomFragmentLoader** hands each segment to hls.js's own loader, staggered by a bounded random
  delay so a crowd at the live edge does not ask in the same instant. Segments, preview segments and
  stream pictures are loaded by hls.js and the browser from the URLs the client gives (`urlFor`),
  written into the playlist or the page, not read through the client. So those loads are not counted
  and a failed one is not asked again of the fallback. `fetchSegmentBytes` is the one place segment
  bytes are fetched, where a provider without URLs can plug in.
- **ManifestStateManager** merges each live playlist into a growing EVENT playlist, so segments stay
  playable longer than the publisher's sliding window.
- **LadderFeedPoller** follows the feed of the quality hls.js plays, plus the one being switched to
  during a switch. A quality left behind forgets where it was, so coming back to it starts at its
  newest playlist. Where it starts comes from a `NewestIndexFinder`, injected so it can be swapped:
  the `MarkerFinder`, which reads the ladder's time marker (`src/shared/ladderMarker.ts`, copied from
  the uploader) and falls back to the `IndexSearchFinder`. How it follows is `followPredicted` in
  `src/features/player/following/`, the polling study's choice. The study's simulator and the strategies it was compared with are in `test/feedModel/`.

Feed URIs use a `swarm://<owner>/<topic>` scheme, because hls.js resolves every playlist URI against
the playlist's own URL and a URI with a scheme is the one case it leaves untouched.

## The Swarm client

`src/swarm/` is the one layer that reads Swarm, plain TypeScript with no React, and it imports nothing
from `src/app` or `src/features`. The features and the app read only through it: a test fails on a line
there that builds a Bee URL, calls fetch, or makes a Bee client of its own (`test/swarm/boundary.test.ts`).

- **Where each feature reads.** `AppProvider` makes one client at start from `config.json` and the
  viewer's node, and makes it again when the viewer picks another node. Components get it from the app
  context. The player reads through `reader('player')`, the stream list through `reader('stream-list')`,
  the previews and pictures through `reader('previews')`, the node picker checks a node through its
  provider's `probe()`, and the chat reads through `reader('chat')`, which goes to `chat.readUrl`.
- **The chat.** swarm-chat-js 7.2.0 is handed a source and a write in place of its own Bee client
  (`src/features/chat/chatParts.ts`). The source makes the library's own reads at the same URLs: the
  feed head, each slot and note as a single-owner chunk checked to be the chat owner's
  (`src/swarm/singleOwnerChunk.ts`), and history files as bytes. A 404 and a 500 both mean a chunk is
  not there, as the library rules. A message is written exactly as the library writes it, to
  `chat.writeUrl`, because it costs a stamp the viewer does not hold.

- **A provider** is one way of reaching Swarm (`src/swarm/provider.ts`), holding only what the app reads:
  a feed's head, a feed entry by index, a single-owner chunk's payload by its owner and identifier (a
  feed entry is one, and so is a ladder's time marker), a chunk, the bytes a reference names, and a URL
  for what the browser or hls.js loads itself. It also says what it can do, its status, a probe, and start and stop
  for a node in the tab. `src/swarm/providers/bee-http/` is Bee's HTTP API, asking the paths the app has
  always asked.
- **Every read answers and never throws** (`src/swarm/answers.ts`): the content, with the feed index
  and the server time where the answer carries them, not found, rate limited with the wait asked for,
  unsupported, unavailable with its cause (a timeout, a status or no answer at all), or aborted. Every
  read takes a signal and a window, ten seconds when none is given. Bee's 404 is not found, its 429 is
  rate limited with its `Retry-After` capped at a minute, and any other failing status, a 500 included,
  is unavailable. A chunk read is the exception: Bee answers 500 for a chat slot never written, which an
  idle chat asks for on every poll, so there a 500 is not found and never pauses the node.
- **The client** (`src/swarm/client.ts`) is made from the settings and the viewer's choice by
  `createSwarmClient`, which makes each gateway's provider through the registry of kinds
  (`src/swarm/registry.ts`). Each feature (the player, the stream list, the previews, the chat) reads
  through its own provider with the fallback behind it. A provider that faults three times in a row is
  left alone for 15 seconds, twice that each time it faults again at once, up to two minutes, and a
  rate-limited one for as long as it asked. A paused provider is still asked when nothing else can be.
  A read's window covers the fallback too: the fallback gets only what the first provider left of it,
  and is not asked once nothing is left. URLs come from the first provider that is not paused, and a
  playlist the player already holds names its segments again whenever that provider changes, at a pause,
  at its end, or at a switch of node.
  Every read is counted by feature, kind, provider and answer, and `activity()` gives the last minute's
  answers per feature with how many came from the fallback, which the control panel's status view shows. The server time of the player's and the
  stream list's answers keeps the gateway clock, and the chat's, read from the chat's own host, does not.
- **The contract** (`test/swarm/providerContract.ts`) is the suite every provider kind must pass, run
  for Bee over HTTP against the answers the browser smoke test replays.

## The design

One look today, Swarm Brand v3.0 as msrs-client's Swarm theme draws it: near-black surfaces, the
Swarm orange `#f47a20` as a sparing accent, Geist for all text, and JetBrains Mono only for the
configuration problem's detail and the playback quality overlay. A deployment picks its theme in
`config.json`, and there is no switcher for viewers.

- **The tokens.** The scales (sizes, spacing, type steps, radii, timing) live in
  `src/design/_tokens.scss`, one Sass map per group. What a theme decides, its colours and typefaces,
  lives in `src/design/themes/`, one file per theme. `src/design/theme.scss` emits the scales once on
  `:root` and each theme under `:root[data-theme='<name>']`, the default theme on a bare `:root` too,
  as CSS custom properties named `--<group>-<name>`, for example `--color-primary` or
  `--spacing-base`. It also sets the page's base styles.
- **Components read only the variables**, `var(--color-primary)`, never a Sass token or a literal
  colour. The breakpoints are the one exception, because a media query cannot read a custom
  property: they are the mixins in `src/design/_media.scss`, and every layout is written for a phone
  first and widened by them.
- **To add a token**, add a scale to its map in `_tokens.scss`, or a colour or typeface to every
  theme in `src/design/themes/`, and read it where it is needed. The tokens test
  (`test/designTokens.test.ts`) fails when a stylesheet reads a variable the design does not define,
  when the design defines one nothing reads, when one theme lacks a variable another has, and when a
  text colour falls below 4.5:1 against its background. A new colour pairing goes into its list too.
- **The fonts** are bundled from `@fontsource`, only the weights used: Geist 400, 500, 600 and 700,
  and JetBrains Mono 500, imported in `src/design/fonts.ts`. The page makes no font request to a
  third party. Another weight needs its file imported there, or the browser fakes it.

## Layout

```
src/
  app/          the entry, routes, the app provider, the page layout and header
  config/       the runtime configuration, read and checked at start
  design/       the design tokens, the Swarm theme, the fonts and the logo
  features/
    catalog/    the stream list: feed reader, schema, polling, previews
    player/     the Swarm HLS player, its loaders and overlays, the watch page
    gateway/    the Bee node picker and its health check
    chat/       the chat panel, the display-name login, the chat library's lifecycle
  swarm/        the Swarm client, its providers and their answers, and the settings it is made from
  shared/       the stream list format and feed helpers copied from streaming-monorepo, the fetch
                helpers every feature uses, and the components more than one feature uses
test/           the unit tests, test/shared for the copied modules, test/chat for the chat against a
                stand-in for the chat library
```

The files in `src/shared` that came from streaming-monorepo name the path and commit they were
copied from. Refresh them from there when the stream list format changes. The chat in
`src/features/chat` started as a copy of msrs-client's at `a2f50151`, and has been rebuilt since.

## Licence

MIT, see [LICENSE](LICENSE).
