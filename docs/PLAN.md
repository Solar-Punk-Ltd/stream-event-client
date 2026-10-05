# stream-event-client: the plan

Status: active. Phases 1 to 4 are done, phase 5 is next. Each phase starts on the owner's go
(decision 7).

## What this is

A small web app for watching the Devcon 8 streams (Mumbai, 3 to 6 November 2026) over Swarm. A
viewer opens it, sees the event's streams, watches one, and chats with the other people watching.
It carries nothing else: no admin, no sign-in beyond a chat name, no postage stamps (what pays for
storing data on Swarm), no uploads and no stream management.

It is put together from two existing Solar Punk codebases:

- **The viewer** from the streaming monorepo, the most tested version of the player, with its
  current dependency versions.
- **The Swarm design and the chat** from msrs-client, which carries the Swarm Brand v3.0 theme and a
  working chat with a display-name login.

The Swarm Foundation is expected to take the codebase over later, so it is written to be read and
changed by people who were not here when it was built.

## Sources

| What                                                             | Taken from                                                                                                   | At                                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Stream list, watch page, HLS player, Bee node picker             | [streaming-monorepo](https://github.com/Solar-Punk-Ltd/streaming-monorepo) `apps/hls-stream/packages/client` | `main` at `c1696c26` (2026-09-28)                                                           |
| The stream list format and feed helpers the viewer imports       | the same repository, `apps/hls-stream/packages/shared` and `packages/contracts`                              | the same commit                                                                             |
| Design tokens, the Swarm theme, the chat, the display-name login | [msrs-client](https://github.com/Solar-Punk-Ltd/msrs-client)                                                 | `master` at `a2f50151` (2026-09-24), which holds the Swarm theme (#20) and Brand v3.0 (#22) |

The code arrives as a copy, without the history of either repository. The first commit of phase 1
copies the source files unchanged and names the commits above, and the moves and edits follow in
commits of their own, so every change can be read against where the code came from.

## What a viewer can do

1. **Browse** the event's streams, live first, then upcoming, then finished, each with its
   thumbnail or a frame from the stream. Each live stream and the next upcoming one, with a
   countdown to its start, are featured above the cards, the past streams come eight to a page, and
   a search box filters by title, description and tags. The list is read from a Swarm
   feed, an address whose owner can keep publishing new versions of it, and it refreshes every five
   seconds without a reload.
2. **Watch** a stream. Quality adapts across the qualities the stream is published in, its ladder,
   for example 360p to 1080p. A quality that stops publishing is dropped within seconds. A broadcast
   that pauses and comes back is rejoined. A scheduled stream says when it starts and begins playing
   on its own when it goes live.
3. **Choose where the video loads from**: the event gateway by default, which is a Bee node the
   event runs for every viewer, or a Bee node on the viewer's own machine, for example Swarm Desktop
   at `http://localhost:1633`. The node is checked before the switch, and a failure is explained in
   plain words: wrong port, not a Bee node, or the node refused this site. The choice is remembered,
   and the way back to the event gateway is one click. On a page a browser loaded from Swarm over
   `bzz://`, such as Freedom, the browser's own node takes the place of the address, which that page
   cannot reach, and is the default: the video loads from it, and the stream list and playlists too
   where the browser gives the page `window.swarm` to read feeds with, within the browser's read limit
   per site, with the event gateway behind it. Freedom allows a site the viewer has not connected 120
   reads and 512 KiB a minute (600 reads and 5 MiB once connected). A finished stream's playlist can
   be larger than 512 KiB on its own, so the first read of it costs a refusal and a minute of feed
   reads on the gateway. After that it is read from the gateway until the viewer connects the site.
   Freedom reports a slot its node could not retrieve as missing, so the poll after a refusal asks
   the gateway instead, whose answer tells a missing slot from a failing node, and a waiting
   follower's polls alternate between the two, never both on one poll. The node misses a slot that
   is not there yet in about two seconds, about as long as a segment, so at the live edge the gateway
   serves most new slots until the node gives up on a missing slot faster. A feed head the node calls
   empty is asked of the gateway, and read from the gateway alone while the gateway agrees it is
   empty.
4. **Chat** beside the video, one chat per stream: send a message, react with an emoji, reply in a
   thread, load older messages, and retry a message that failed to send. Reading needs no name.
   Writing asks once for a display name, which creates a key in the browser that signs the
   messages. There is no password, no wallet and no account.
5. **Diagnose playback**: `?qoe=1` on a watch page shows a playback quality overlay, and
   `?level=720p` pins one quality. Both come from the monorepo viewer, because at an event they are
   how a slow gateway is told apart from a broken quality.

## What stays out

| Left out                                                                                       | Where it was    | Why                                                       |
| ---------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------- |
| Admin sign-in, wallet connection (MetaMask, wagmi)                                             | msrs-client     | Not part of the event client                              |
| Creating, editing, pinning and managing streams, the uploader, the stamp dashboard and top-ups | msrs-client     | The same                                                  |
| The other three themes and the theme switcher                                                  | msrs-client     | Swarm theme only                                          |
| The Swarm theme's background video                                                             | msrs-client     | Brand v3.0 had already removed it                         |
| Waku push delivery for the chat, with its libraries and its node                               | msrs-client     | The owner's call, 2026-09-29: the chat is read by polling |
| The in-tab Bee node (weeb-3)                                                                   | monorepo viewer | Decision 1                                                |
| The hooks the monorepo's test harness drives, and its build stamp file                         | monorepo viewer | Decision 2                                                |

## How it is built

### Layout

```
src/
  app/          providers, routes, the page layout and header
  config/       the runtime configuration, read and checked at start
  design/       the design tokens and the Swarm theme, as CSS custom properties
  features/
    catalog/    the stream list: feed reader, schema, polling
    player/     the Swarm HLS player and its loaders
    gateway/    the Bee node picker and its health check
    chat/       the chat panel, the display-name login, the chat feed polling
  shared/       the stream list format and feed helpers copied from the monorepo
```

Both sources sort code by kind (components, pages, providers, utils). Here it is sorted by feature,
so the chat, the player and the picker can each be read, tested and replaced on their own.

### Changes from the sources

1. **One build for every deployment.** The monorepo bakes the stream list's owner and topic into
   the bundle when it is built. Here every setting comes from a `config.json` served beside the
   page and checked against a schema when the app starts, so one image serves every environment and
   a setting such as switching chat off changes without a rebuild. A page that cannot read its
   config says so, instead of showing an empty list. msrs-client already did this with
   `window.__CONFIG__`.
2. **Design tokens as CSS variables, themes picked per deployment.** msrs-client keeps its tokens in
   Sass maps and switches between four themes at runtime through a `data-theme` attribute, a React
   provider and local storage. Here every component reads only CSS custom properties. The scales are
   emitted once, and each theme's colours and typefaces under its own `data-theme`. A deployment
   picks its theme with `theme` in `config.json`, `swarm` being the only one and the default. Each
   theme carries its logo, page copy and footer links in `src/design/themes.ts`. A switcher for
   viewers, the provider and the stored choice do not come along.
3. **The chat loads beside the video.** The chat and its libraries are a separate file of the
   bundle, about 33 KB, fetched as the watch page opens. It first waited for the video's first frame,
   which kept the chat away for about 6 s on the live site, and the owner moved it beside the video
   on 2026-10-01. The emoji picker is fetched the first time it is opened.
4. **A lighter login.** msrs-client makes the chat key by hashing a random id with `viem`, a large
   library brought in for one hash. Here the key is 32 random bytes from the browser's own crypto,
   so `viem`, `wagmi`, the MetaMask SDK, `crypto-js`, `msgpack-lite`, `pako` and `bs58` stay out.
5. **Every stream on the list.** The monorepo viewer keeps the last ten entries and drops the rest
   without a word. The event runs more parallel stages than that, so every entry is shown.
6. **A picker for the two sources the event needs.** The picker offers the event gateway and "my own
   Bee node", with `http://localhost:1633` filled in and the port editable. It accepts a node on the
   viewer's own machine (`localhost` or `127.0.0.1`), and the page's content security policy, the
   list of hosts a page may reach, allows exactly that. A node on another machine would need that
   policy opened to every host, which is a later step if wanted. The monorepo's health check and its
   plain-language failures stay.
7. **Fonts served by the app.** msrs-client's Swarm theme loads Geist, Vend Sans and JetBrains Mono
   from Google Fonts. Here Geist and JetBrains Mono are bundled, and Vend Sans is left out because
   msrs-client sets no heading on the browse and watch pages in it. So the page makes no third-party
   request and does not depend on Google being reachable from the venue.
8. **Fixes found while reading the sources**: `onKeyPress`, which React has deprecated, becomes
   `onKeyDown`. The invalid `role="main-layout"` goes. Dialogs keep focus inside and close on
   Escape. The chat hook's `any` types become real types.
9. **Current versions, pinned.** Every dependency moves to its newest stable release that is at
   least two weeks old, pinned exactly, and the install refuses any version younger than a week, as
   in the monorepo. Each version a change brings in is checked for its publish age, its signature
   and provenance, and known malware before it lands.
10. **Node polyfills only if still needed.** The monorepo viewer bundles browser stand-ins for
    Node.js built-ins such as `Buffer`. Once weeb-3 is gone the build is tried without them, and
    they stay only if bee-js still needs them in a browser.
11. **Size is a number.** Every pull request reports what the first page load downloads, so
    "lightweight" can be checked rather than claimed. It is reported, not a gate.
12. **Phone first.** Many viewers will watch on a phone, so every screen is laid out for a narrow
    screen first. The watch page keeps a place for the chat, under the video on a phone and beside
    it on a desktop, from phase 2. The chat itself, and folding it away on a phone, come in phase 3.

### The configuration

```json
{
  "gatewayUrl": "/bee",
  "catalog": { "owner": "<stream list feed owner address>", "topic": "<stream list topic>" },
  "chat": {
    "enabled": true,
    "readUrl": "<Bee endpoint the chat is read through>",
    "writeUrl": "<Bee endpoint that stamps and takes chat writes>",
    "gsocResourceId": "<the shared key every viewer writes chat messages with>",
    "gsocTopic": "<GSOC topic>",
    "feedOwner": "<chat feed owner address>",
    "pollIntervalMs": 500
  }
}
```

The values are placeholders. Real ones live with the deployment, never in this repository. Two
notes on them:

- `gsocResourceId` is a private key by design, and every viewer receives it. The GSOC address is
  shared, so everyone writes to it with the same key, chosen (mined) so that the address lands
  where the aggregator's node listens. It is public configuration, not a secret, and the check for
  keys in the tree has to know that.
- `config.json` is served with `Cache-Control: no-store`, so a changed setting reaches every page
  opened after the change.

### How the chat works, and what it needs outside this repository

The chat runs on swarm-chat-js 7.0 and the chat aggregator server it pairs with,
[swarm-chat-aggregator-js](https://github.com/Solar-Punk-Ltd/swarm-chat-aggregator-js). Swarm stores everything in
4 KB pieces called chunks, and each chunk is paid for with a postage stamp.

1. **Sending is one write per message.** A viewer's message is signed with their chat key and written once, as one
   chunk, to the chat's GSOC address, the inbox. A GSOC address is a Swarm address that anyone holding its shared key
   may write to and that one node listens on. Every chat of the event shares one inbox, and a message carries its
   chat's topic. The chat's Bee endpoint stamps the write, so the client holds no stamp. A message is at most 500
   characters of text and 2,048 bytes whole, and the composer counts both before it sends.
2. **A message stays pending until the feed shows it.** Until the viewer reads its own message back from the chat
   feed, the library writes the identical chunk again every 10 seconds, five times at most, and then marks the
   message not sent, with a retry button. While the chat itself cannot be read, the resends wait, so a message is not
   failed only because this viewer lost sight of the feed.
3. **The aggregator publishes.** It listens on the inbox, checks each message's shape and signature, and writes it to
   that stream's chat feed as the next entry, at index 0, 1, 2 and on, signing with its own key and paying with its
   own stamp. After publishing it saves a history file of the chat, and every feed entry links to the newest one.
4. **Viewers read by polling the feed and its history files.** Opening a chat asks Bee for the feed's newest entry
   once, shows the history file that entry links to, and then reads the entries after it. At the live edge the panel
   polls the next feed slots, every `pollIntervalMs`, which is a setting so it can be raised under load without a
   rebuild. Older messages load on a click, one history file at a time. A slot or a history row that fails its checks
   is skipped and never stops the chat. While the chat endpoint does not answer, or a message known to exist has not
   loaded, the panel says so over the messages it has.
5. **Reading needs a key too.** The chat library signs with a key even to read, so a viewer with no name reads with a
   fixed placeholder key, and the panel asks for a name before anything is sent.

For chat to work live, two things must run outside this repository: the chat's Bee endpoint with its stamp, and the
aggregator with its key and stamp. A new aggregator is set up for this app, apart from this repository, and its details
come later (the owner, 2026-09-29). The aggregator's own live test bed, three Bee nodes on a local test chain, runs
messages in the 7.0 format through real nodes. This app's panel is tested against stand-ins until the aggregator is
set up. Whoever sets that up needs these two constraints:

- **The node viewers write through must be a different Bee node from the one the aggregator listens on.** Bee hands a
  GSOC chunk to a listener only when the chunk arrives from another node, so a message written on the listener's own
  node is never heard.
- **The chat endpoint's stamp must be a mutable batch of depth 24 or more.** Every message is a write to the one inbox
  address, so every message lands in the same one of the batch's buckets. A bucket holds 2^(depth - 16) chunks, so 16
  at depth 20 and 256 at depth 24. Both limits were measured on the aggregator's test bed:
  - An immutable batch fills that bucket and then refuses every further write with `400 chunk write error`. Bee buys
    an immutable batch unless it is asked for a mutable one, so a batch bought with the defaults stops the whole
    event's chat once that one bucket is full, after 256 messages at depth 24.
  - A mutable batch reuses the bucket's slots instead. At depth 20, 200 messages sent at once reused 16 slots so fast
    that a write arriving late found its slot already holding a newer message, and the node refused it with
    `500 done split failed`. At depth 24, 256 slots, the same test ran clean.

The Bee node picker moves the stream list and the video. The browser's own node, offered on a page loaded over `bzz://`,
moves the video, and moves the stream list and playlists through `window.swarm` where the browser provides it, because
`bzz://` serves no feeds. Freedom limits those reads to 120 a minute per site, 600 once the viewer connects the site
from the picker, and what it refuses goes to the event gateway. The chat keeps its own endpoint, because a viewer's own
node holds no stamp for writing.

### Tests

- The viewer's unit tests come along for every module that comes along. The msrs-client chat and
  login tests are ported to React 19.
- New tests cover the config check, the picker's two choices, the display-name login and the design
  tokens, so a component cannot read a variable the theme does not define.
- The chat is tested against a stand-in for the chat library's network calls, so phase 3 needs
  neither a node nor an aggregator.
- A browser smoke test opens the list, watches a stream and sends a chat message. It runs against
  recorded Bee answers, a short recorded stream and a chat feed, which the browser test serves from
  its own request routing, so it needs no live infrastructure and no fake server. Recording and
  wiring those answers is part of phase 4.
- Every pull request runs lint (oxlint), the format check (oxfmt), the typecheck, the unit tests,
  the build, and from phase 4 the browser smoke test.
- Browser suites check that things work, never how fast. Timings are reported and never asserted.

## Phases

Each phase is one branch and one pull request into `main`, reviewed before it merges, with the docs
it changes in the same pull request. The target dates assume the decisions below are answered this
week, and leave the two weeks before the event for rehearsal with the real streams and chat.

| #   | Phase                  | Done when                                                                                                                                                                                                                                                                                                                                               | Target                         |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 0   | This plan              | The repository exists, this file is on `main`, the decisions are answered                                                                                                                                                                                                                                                                               | 2026-09-30                     |
| 1   | The viewer, standalone | The viewer, the shared pieces and the picker are in the new layout, weeb-3 is gone, decision 2 is applied, the runtime config works, every stream is listed, the toolchain is the monorepo's, dependencies are current and checked, the kept tests and CI are green                                                                                     | Done 2026-09-29, PR #1         |
| 2   | Swarm design           | Tokens and the Swarm theme are in, every screen uses them on a phone and on a desktop, the watch page keeps a place for the chat, fonts, logo and favicon are bundled, no theme machinery is left, and the tokens test is green                                                                                                                         | Done 2026-09-29, PR #2         |
| 3   | Chat                   | The display-name login and the chat panel work on the watch page on swarm-chat-js 7.0, reading the chat feed and its history files by polling, with the ported and new tests green. Tested against stand-ins, because the aggregator for this app is not set up yet, so a message from this app has not yet gone through a real endpoint and aggregator | Done 2026-09-30, PRs #3 and #4 |
| 4   | Ship                   | The Docker image, nginx with the page fallback, caching, `config.json` served uncached, a content security policy that allows the gateway, the viewer's own machine and the chat endpoint, the config mounted at start, and the browser smoke test with its recorded answers in CI. A deploy to a staging host only on the owner's word                 | Done 2026-09-30, image v1.0.0  |
| 5   | Review and docs        | A review for broken logic, races, loops that never end, unhandled errors and anything that leaves a viewer unsure what is happening, each finding fixed or recorded. Docs and comments read against the code and fixed. A check that no host, address or key is in the tree                                                                             | 2026-10-19                     |

Phase 2 left no theme machinery. Theme selection per deployment came back on the owner's word of
2026-09-30, see change 2.

## Decisions for the owner

1. **The in-tab Bee node.** The monorepo viewer can fetch video through a Swarm node running inside
   the browser tab (weeb-3). It is off in every shipping build, adds close to 4 MB of WebAssembly
   when switched on, and needs its worker files served from the same site. The request names two
   sources, the gateway and a local node. The monorepo treats the in-tab node as the first subject
   of its viewer measurements, and that stays as it is there: this decision is only about what this
   app ships.
   - A (recommended): leave it out, and keep the one place where the player fetches video bytes as a
     seam, so a different way of fetching can come back there as one module.
   - B: keep it as a build option that is off by default, which keeps its build step and its tests.
2. **The test hooks and the build stamp.** The monorepo viewer carries two things for its test
   harness. The hooks put the player and the gateway on `window`, so the harness can drive them, and
   a shipping build compiles them away. The build stamp is a small file saying which commit a
   deployed bundle was built from.
   - A (recommended): keep a build stamp, because at the event it tells a stale deploy from a current
     one at a glance, and leave the hooks out, because nothing here calls them and this app gets its
     own browser test.
   - B: keep both. Worth it only if the monorepo's live test suites should also run against this app
     before the event, which would still take work to point them here.
3. **The stream list format.** The viewer reads the stream list through a schema and feed helpers
   that live in the monorepo's shared packages.
   - A (recommended for now): copy the pieces it uses into `src/shared/` with the source commit
     named, and test them against sample entries copied from the monorepo's own tests. The cost is
     that the copy can fall behind a format change until someone refreshes it.
   - B: publish the monorepo's `contracts` package to npm and import it here, one copy for both. The
     cost is a release step in the monorepo each time the format changes.
4. **The chat library.** Chat runs on swarm-chat-js 6.2.8, which is built on bee-js 9, zod 3 and
   cafe-utility 27, while the viewer uses bee-js 13, zod 4 and cafe-utility 36. Used as it is, the
   app ships two copies of each, so a bigger download and two Bee clients.
   - A (recommended): build on 6.2.8 now so chat works early, then release swarm-chat-js 7 on
     bee-js 13 and move to it before the event. The move is mostly renames, the same move from
     bee-js 9 to 13 the monorepo made. A release to npm is the owner's to approve.
   - B: upgrade the library first, which delays chat by that work.
   - C: copy the chat core into this repository. No library to release, but the message format then
     lives in two places, here and in the library the aggregator uses, and the copied code keeps the
     library's Apache-2.0 notice.
5. **Public or private.** The repository starts private. Both sources are public and the Swarm
   Foundation will take it over. Recommended: public once phase 1 has merged and the tree is checked
   for hosts, addresses and keys.
6. **Licence.** The monorepo is MIT, and msrs-client has no licence file, its code being Solar
   Punk's own. Recommended: MIT with the monorepo's text, added in phase 1.
7. **Pace.** In the monorepo each phase waits for the owner's go. Option B sets that aside for this
   repository only.
   - A: each phase ends with a short summary and the next starts on the owner's go.
   - B (recommended, given the date): phases 1 to 3 run one after another with a summary after each,
     and the work stops before anything is deployed, which stays the owner's word.

### Answered

- **Chat delivery** (the owner, 2026-09-29): no Waku. Viewers read the chat by polling.
- **The chat service** (the owner, 2026-09-29): a new aggregator is set up for this app, apart from
  this repository. Its details come later.
- **Decision 1, the in-tab node** (the owner, 2026-09-29): left out for now, to be added later, so the
  player keeps the place where another way of fetching plugs in.
- **Decision 2, test hooks and build stamp** (the owner, 2026-09-29): both dropped.
- **Decision 3, the stream list format** (the owner, 2026-09-29): A, copied into `src/shared/` with the
  source commit named and tested against sample entries from the monorepo's tests.
- **Decision 4, the chat library** (the owner, 2026-09-29): discussed later. Until then chat is built
  on swarm-chat-js 6.2.8 as it is. Later the same day the owner gave the go for swarm-chat-js 7.0 on
  bee-js 13, and the chat moved to it, first from a vendored copy. 7.0.0 was published to npm on 2026-09-30, and the
  app takes it from there.
- **Decision 5, visibility** (the owner, 2026-09-29): public once phase 1 has merged and the tree is
  checked for hosts, addresses and keys.
- **Decision 6, licence** (the owner, 2026-09-29): MIT, added in phase 1.
- **Decision 7, pace** (the owner, 2026-09-29): A, each phase ends with a summary and the next starts on
  the owner's go.
- **Stream list order** (the owner, 2026-09-29): live, then upcoming, then finished.
- **The Swarm design, again** (the owner, 2026-09-30): the viewer follows msrs-client's Swarm site as
  it runs, and a deployment picks its theme with a setting, with no theme beyond `swarm` added.
  On 2026-10-01 the owner kept text on orange dark for contrast, took msrs-client's chat look with
  the name on hover, left the footer's newsletter form out, and kept the footer's links as
  msrs-client has them for now.

## Risks and limits

- **Chat reads at event scale.** At the half-second interval msrs-client used, polling costs about
  two reads per viewer per second, and they all land on the chat's own endpoint, not on the video
  gateway. With thousands of viewers that is thousands of reads a second on one endpoint. The
  interval is a setting, and the load is measured on a staging setup before the event, not assumed.
- **The chat's first read grows with the chat.** Opening a chat downloads the latest history
  snapshot, so late in a busy day every newly opened chat starts with a large read. How big the
  snapshot may grow is the aggregator's to decide.
- **A message can miss the listener on the public network.** A chunk reaches the inbox's listening node only when the
  node one hop before it pushes the chunk there. Bee's push picks the closest peer it rates healthy first, so while
  that hop rates the listener unhealthy, it hands the chunk to another node in the neighbourhood, which stores it, and
  the aggregator never hears the message. Read in Bee's source and seen on the aggregator's test bed, where it lost
  197 of 200 messages until every node rated the listener healthy. The bed overstates how often it happens, because
  there a fresh cluster of three nodes rated the listener unhealthy for a whole run, while on the public network such a
  rating comes and goes. It does not overstate what happens. The net is the library's resend: each resend is a new
  write and so a new push, which can reach the listener once the hop before it rates it healthy again, and after five
  the viewer sees the message marked not sent, with a retry. How often it happens there is measured on a staging setup
  before the event.
- **The chat endpoint's stamp is a setup step that fails quietly.** A batch bought with Bee's defaults is immutable,
  and the chat then stops for every viewer once the inbox's one bucket is full. The constraint and its reasons are
  under how the chat works. Whoever sets up the endpoint checks the batch is mutable and of depth 24 or more, and
  watches its expiry, because a batch that runs out stops the chat the same way.
- **Chat moderation.** Anyone can post under any name, and the display name proves nothing about who
  someone is. Every message costs the chat endpoint one stamped chunk, and one more for each
  resend, so a flood of messages spends its stamp. Nothing in this plan filters messages. If the event needs moderation or
  a rate limit, it belongs in the aggregator and the chat endpoint, which decide what reaches the
  feed.
- **The chat key lives in the browser's local storage**, so a reload keeps the name. It proves only
  that messages came from the same browser.
- **Reaching the gateway.** A page on its own domain that reads a gateway on another domain needs
  that gateway to allow it (CORS). The image can instead proxy the gateway under its own origin, as
  the monorepo's viewer does at `/bee`. Phase 4 picks whichever the event's delivery setup needs.
- **A viewer's own node** must allow this site's origin in its settings. Browsers let an `https`
  page reach a plain `http` node only on the viewer's own machine, which is the case the picker
  accepts. The picker's failure messages say what to change.
- **The config is read once, when the page loads.** A change reaches pages opened after it. Making
  open pages pick up a change, for example to switch chat off everywhere at once, is a later step if
  the event wants it.
- **The event's wider delivery design** (several gateway tiers, falling back between them, a mirror)
  is not part of this client yet. The player's fetch seam leaves room for it.
