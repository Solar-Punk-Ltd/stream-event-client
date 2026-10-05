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

| Field           | What it is                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `gatewayUrl`    | The event gateway: a path on this site such as `/bee`, which the site proxies to Bee, or an http or https address of a Bee node |
| `catalog.owner` | The Ethereum address that owns the stream list feed                                                                             |
| `catalog.topic` | The stream list feed's topic, as text                                                                                           |
| `chat`          | Optional. The chat's settings, below. Without it, or with `enabled` false, there is no chat anywhere on the page                |
| `theme`         | Optional. Which of the build's themes the page wears, `swarm` by default. A name the build does not carry is refused            |

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
`pnpm format:check` (oxfmt). Continuous integration runs the format check, lint, typecheck, tests and
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
  master playlist on a feed of its own. The player walks every quality's feed itself, so a switch
  costs nothing, and hls.js chooses the quality. A quality that stops being produced while the others
  carry on is dropped within seconds, at most one per stream.
- **Where the video loads from.** The Bee node picker offers the event gateway and a Bee node on the
  viewer's own computer, `http://localhost:1633` filled in and the port editable. Only `localhost`,
  `127.0.0.1` and `[::1]` are accepted. The node is checked before the switch, a failure is explained
  in plain words, and the choice is remembered in the browser. A browser that loaded the page from
  Swarm over `bzz://`, such as Freedom, runs a node of its own, and the picker offers that node in
  place of an address, as the default. The segments then load as `bzz://<ref>/`, older recordings'
  `/bytes/<ref>` URLs included. `bzz://` cannot serve the stream list and playlists, which are feeds,
  so where the page has the browser's `window.swarm` they are read from the same node through it, and
  from the event gateway otherwise. The browser limits those reads per site, 120 a minute and 600
  once the viewer connects the site, which the picker offers. A read the node refuses or cannot
  answer goes to the event gateway, and a refusal over the limit sends the next minute's reads there
  too. The chat keeps its own endpoint.
- **Diagnosing playback.** `?qoe=1` on a watch page shows a draggable playback quality overlay,
  toggled with `Q`. `?level=720p` pins one quality, which tells a bad quality apart from a bad switch.

## How the player reads Swarm

hls.js expects playlists at fixed URLs. On Swarm every playlist update is new content under a feed,
so the player brings its own loaders:

- **CustomManifestLoader** reads the latest playlist from its feed instead of a fixed URL, through
  `fetchFeed`, which is also how the catalog and the stream cards read theirs. With the browser's own
  node in use, `browserNodeFeeds` answers those reads through `window.swarm`, shaped as the gateway's
  answers are, and hands to the gateway what it cannot answer.
- **CustomFragmentLoader** fetches each segment from the gateway, or from the browser's own node over
  `bzz://` with hls.js's fetch loader on a page loaded that way, staggered by a bounded random delay
  so a crowd at the live edge does not ask in the same instant. `fetchSegmentBytes` is the one place
  segment bytes are fetched, where another source can plug in.
- **ManifestStateManager** merges each live playlist into a growing EVENT playlist, so segments stay
  playable longer than the publisher's sliding window.
- **LadderFeedPoller** walks every quality's feed on its own clock, because hls.js refreshes only the
  quality it is playing.

Feed URIs use a `swarm://<owner>/<topic>` scheme, because hls.js resolves every playlist URI against
the playlist's own URL and a URI with a scheme is the one case it leaves untouched.

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
