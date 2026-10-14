# stream-event-client

A lightweight web app for watching the Devcon 8 streams over [Swarm](https://www.ethswarm.org):
browse the event's streams, watch one, choose and test where the video loads from (the event gateway,
another gateway the site offers, or your own Bee node), and chat with the other people watching.

**What is built.** The stream list, the watch page with a player that reads only the quality it
plays and finds the newest playlist from the ladder's time markers, Connect over a Swarm
client made of providers, and a chat beside each stream, in the Swarm Brand v3.0 look.

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
| `providers`     | Optional in place of `gatewayUrl`. The gateways offered and the default, below                                                                                     |
| `catalog.owner` | The Ethereum address that owns the stream list feed                                                                                                                |
| `catalog.topic` | The stream list feed's topic, as text                                                                                                                              |
| `chat`          | Optional. The chat's settings, below. Without it, or with `enabled` false, there is no chat anywhere on the page                                                   |
| `theme`         | Optional. Which of the build's themes the page wears, `swarm` by default. A name the build does not carry is refused                                               |
| `themeSwitcher` | Optional. Whether a viewer logged in to the chat may switch the colours and typefaces between the build's themes, `true` by default                                |
| `swarmId.url`   | Optional. The Swarm ID site a viewer may sign in to the chat with, an origin such as `https://id.example.com`. Without it, or without a chat, there is no sign-in  |

A theme has two halves. Its look, the colours and typefaces, is in `src/design/themes/`. Its content, the
logo, the hero, the footer links and the tab's title and icon, is in `src/design/themes.ts`. The deployment's
`theme` decides both. Every theme defines the same variables, so a page that wears another theme's look leaves
nothing unset, and the tokens test fails on a theme that misses one or on a text colour below 4.5:1.

**The theme switcher.** A viewer in the chat finds a Theme group under their ID in Connect, one
option per theme with a swatch of its page colour, accent and heading typeface. The arrow keys move the pick
within the group, and Tab reaches it at the checked option. A pick changes only the look.
The logo, the words and the tab stay the deployment's, so a Devcon page in the web3privacy look still says
Devcon. The pick is kept in this browser under `viewer-theme`, through reloads and after a logout, and on
the next visit it is worn before the page renders, while the config is still loading. A deployment without chat has no login, so it has no switcher
either, and one with `themeSwitcher` false keeps a viewer's earlier pick without wearing it.

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
read as one Bee gateway and the default, so a deployment written before `providers` needs no change.
Nothing switches source by itself: a part reads from the source the viewer picked and from nothing else,
and when that source fails the page says so and the viewer picks another. The chat history is read from the
source picked for it, and the default gateway's at `chat.readUrl`.
The page's policy allows every https address, so a gateway in `providers.gateways` at an https address
needs nothing more. One at a plain http address must also be named in the image's `EXTRA_GATEWAY_URLS`
(below), or the policy refuses it, unless it is the image's own `BEE_GATEWAY_URL` in direct mode.

The page, not the deployment, decides which kinds of source a viewer may add: a gateway at an https
address, a Bee node on this computer or at an https address, and the node in this browser. No setting
turns a kind on or off. A deployment written for an earlier release may still name `providers.fallback`,
`providers.kinds`, `providers.beeNodes` or a `weeb3` block, and the page reads none of them.

| Field                       | What it is                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `providers.gateways`        | The gateways offered, at least one. Each has an `id`, a `kind`, an optional `label` and its own settings        |
| `providers.gateways[].kind` | `bee-http`, a Bee node's HTTP API, the only kind a deployment may offer as a gateway. Any other kind is refused |
| `providers.gateways[].url`  | For `bee-http`: a path on this site such as `/bee`, or an http or https address, as `gatewayUrl` takes          |
| `providers.default`         | The `id` of the gateway every reader starts on                                                                  |

Serve `config.json` with `Cache-Control: no-store`, so a changed setting reaches every page opened
after the change.

## The chat

One chat per stream, beside the video on a desktop and under it on a phone, where it folds away.
Anyone can read it. Writing asks once for a display name, 1 to 20 characters, and there is no
password, wallet or account. A deployment that names a Swarm ID site in `swarmId.url` also offers
signing in with Swarm ID, described [below](#signing-in-with-swarm-id). A viewer can send a message, react with an emoji, reply in a thread,
load older messages, and retry a message that did not send. The chat and its library are a file of
the bundle of their own, fetched as the watch page opens, beside the video rather than after it, and
the emoji picker is fetched the first time one is drawn: the emoji bar above the message field, or a
reaction's picker beside a message.

**What it needs, outside this repository.** Two services, set up apart from this app:

- **Two Bee endpoints for the chat.** `chat.readUrl` serves the chat's feed and history files.
  `chat.writeUrl` takes the messages and stamps every write, because the page holds no postage stamp.
  A message costs one stamped chunk, and one more for each resend while it has not been read back. A viewer who
  pays with their own stamp, [below](#who-pays-for-a-message), writes through their own Bee node instead.
- **The chat aggregator**, on swarm-chat-js 8, which listens on the shared address the key and topic above name, and
  appends each message to the stream's chat feed, `chat-<stream topic>` under `chat.feedOwner`.
  Opening a chat reads the newest history file the chat feed points to, then the entries after it. The endpoint viewers write
  through must be a different Bee node from the one the aggregator listens on, because Bee hands a
  message on to a listener only when it arrives from another node.

**Why `gsocResourceId` is not a secret.** Every viewer writes to the same shared address, so every
viewer's page carries the same key. It is chosen so the address lands where the aggregator listens,
and it owns nothing but that shared chat address, which every viewer writes to anyway. A check for
keys in the tree has to know it.

**What the browser keeps.** A guest's display name, the chat key made for it (32 random bytes from the
browser's own crypto) and its address sit in local storage under `stream-event-client:chat-session`,
so a reload keeps the name. Logging out, or Leave beside Swarm ID, removes them. Nothing of a Swarm ID
sign-in is kept there. Who pays for the viewer's messages, and whether they keep an own feed, sit under
`stream-event-client:chat-stamp`, read only while they are signed in with Swarm ID. The key proves only that two messages came from
the same browser, and anyone may choose any name. So the badge beside a guest's name opens the
details, where the sender's full public address tells apart two people who chose the same name.

**What the chat checks, and the badges.** Every message is signed by its sender's chat key. The page
checks each one, live, from history and the viewer's own while it is still sending, in a Web Worker
with swarm-chat-js's `verifyChatMessage` and the page's own origin, so a long history never holds up
the page. History is checked in batches of 25, and each batch shows as soon as it passed. A message is
shown only once it passed. One that fails, whether its text was changed after signing, its Swarm ID
binding was made for another site, or it is in the format before version 8, is never shown, and the
panel counts them in its `data-refused-messages` attribute. A chat whose history is all of the older
format opens as an empty chat. The worker is the bundle's own file, so the page's policy allows it with
`worker-src 'self'`. A worker that cannot start or fails is left, and the same check runs on the
page's thread instead, for the messages it held and every later one. Nothing is shown unchecked and
nothing is left waiting."

Above each message is its sender line: the name, the badge, the stamp for a message sent with the
sender's own stamp, and the time it was published, in hours and minutes on the viewer's clock. There
is no initial and nothing floats over the row. A grey outline hexagon after a name in the plain weight
is a guest, told apart only by the key their browser keeps. A filled hexagon with a check
after a name in the accent colour is a Swarm ID account, which signed a statement that this chat address
on this site is its own. A stamp after the badge says the sender paid for the write with a stamp of
their own. Every message this page sends says who paid, the event gateway or the viewer's own stamp. The badge, and the stamp where
there is one, open the message's details: the name, the identity, the public chat address, that the signature
matches the text, for a Swarm ID the link Swarm ID confirmed for this site and the account's address,
and who paid for the write.

### Signing in with Swarm ID

Connect offers two ways in. **Chat as guest** takes a name, as above. **Sign in with Swarm ID**
opens the Swarm ID window, which the Swarm ID site draws, not this page. The person picks an account
there, or makes one. The ID then gives this site its chat key for that account and a chat binding, the
account's signed statement that the key's address on this site is its own. Every message is signed
with that key and carries the binding, so every reader shows the Swarm ID badge. The page never
connects a wallet and never sees the account's own key. Messages go through the event gateway, which
stamps them, unless the person picks their own stamp, as the next section says.

- **The Bee node Swarm ID uses for this site.** The page hands Swarm ID the address of the source picked
  for the chat history, as a Bee API base, when it starts the library and again whenever that source
  changes, so this site's content in Swarm ID follows the viewer's choice. For the event gateway that is
  `chat.readUrl`. A source with no Bee address, the node in this browser, is never handed over, and Swarm
  ID then keeps the address it had, as it does when it refuses one, which is asked for again at the
  next change. Swarm ID's coordination of the person's account and devices stays
  on their own node whatever this page names. The address is handed over absolute, so `/bee` arrives as
  this site's own `/bee`.
- **Swarm ID reads that address from its own origin**, through its hidden frame, so the address has to
  let the Swarm ID site read it. The image does this for `/bee` in proxy mode when `SWARM_ID_URL` is set:
  `/bee` then answers that one origin, never `*`, with the gateway's own CORS headers replaced, and answers
  a preflight for GET itself. The image serves nothing else Swarm ID may be handed. **A deploy requirement:**
  `chat.readUrl`, a gateway in direct mode and every gateway in `providers.gateways` are on hosts of their own,
  and each has to allow the Swarm ID site's exact origin for GET itself, or Swarm ID cannot read this site's
  content through it.
- **The chat name** is the account's name, trimmed and cut to the chat's 20 characters. An account
  with no name chats under its short address. The header shows the chat name with its badge, the grey
  hexagon of a guest or the filled one of Swarm ID, as every message does. Connect says "Swarm ID" and the account's name
  beside it, with Sign out.
- **A guest can sign in later.** The menu of a guest says "Show it's really you" beside Sign in with
  Swarm ID. Signing in keeps the guest's name and key in this browser, and signing out chats as that
  guest again. Leave forgets the guest.
- **What stays in memory only.** The chat key, the binding and who is signed in are never written to
  storage. A reload asks the Swarm ID library, whose frame keeps its own session for this site and
  signs the person in again without a window. When that session has ended, the person signs in again
  and the window opens again. Sign out ends that session too, so a reload does not restore it.
- **A blocked window.** A browser opens the window only on a click. When it blocks it anyway, the page
  says "Your browser blocked the Swarm ID window." with an Open Swarm ID button, whose click opens it.
- **A binding the chat would refuse** is refused at sign-in rather than at every message: one made for
  another site, naming another address than the key's, or signed by another account than the one the
  frame says is signed in, leaves the person signed out with the reason.
- **When the Swarm ID site cannot be used**, as for a site it does not serve, Connect says it
  cannot be reached and guests chat as before.

### Who pays for a message

Connect has a **Chat stamp** group, between ID and Swarm access, once the viewer is chatting. Every message on
Swarm needs a postage stamp, and the group offers two ways to pay.

- **Gateway pays**, the default for everyone, as before: the message goes to `chat.writeUrl`, which stamps it.
- **My stamp**, offered once signed in with Swarm ID. The stamp is the one Swarm ID gives this site. It is bought,
  topped up, made bigger and chosen for the site in Swarm ID, never in this page, which holds no stamp and no stamp
  key. For each message the page builds the chunk, Swarm ID signs and stamps it in its frame with `stampChunk`,
  and the page sends the stamped chunk itself, `POST /soc/<owner>/<id>?sig=...` with the stamp in Bee's
  `swarm-postage-stamp` header, through the source picked for **Chat history** in Use for. Every message says
  `via: "own-stamp"`. The chat's inbox is one single-owner chunk address, which Swarm ID stamps again in the slot
  it already holds, so a busy chat costs one slot of the stamp rather than one per message.
- **Which source can send it.** Only a Bee node of the viewer's own stores a chunk under a stamp it is handed, so
  My stamp needs a Bee node picked for Chat history. The event gateway's chat path stamps every write with the
  gateway's own batch, a `/bee` path on the site passes reads alone, and the page cannot tell what any other gateway
  does with a stamp, so with a gateway picked My stamp says why it cannot be used, and names the fix. The node in
  this browser sends chat messages in a later release. The Bee node must allow this site's origin
  (`cors-allowed-origins`) for the write as for its reads, and needs the stamp's chain to check it, so a light
  node or a full one, not an ultra-light one.
- **Nothing switches by itself.** A message Swarm ID will not stamp, or the node refuses, shows "Not sent." with
  the reason, and is never resent through the gateway. A refusal a resend cannot mend, such as a stamp that ran
  out, fails the message at once, and Retry tries it again on the same stamp. A node that did not answer, or a
  busy Swarm ID, is resent by the chat on its own, on the same stamp and through the same node. When the source
  picked for Chat history changes to one that cannot send on the stamp, the choice stays, sending is held with
  the reason, and the viewer picks a Bee node again or presses Let the gateway pay.
- **The stamp's figures.** With My stamp picked, Connect shows the site's stamp: its name, how full it is, its days
  left, and **Change stamp in Swarm ID**, which opens this site's row on Swarm ID's Apps screen,
  `<swarmId.url>/#apps/<this site's origin>`, in a window of its own. The figures are read from Swarm ID's
  `getPostageBatch` when the person signs in, when Connect opens, when that window closes, when the page comes back
  into focus, and after messages sent, at most every 15 seconds. **A known limit:** in the hosted Swarm ID, a site
  on another domain does not hear of a stamp change, live or on reload, until the person signs in with Swarm ID
  again, so a changed stamp may show its old figures until then. With no stamp given, Connect says so and offers
  Choose a stamp in Swarm ID.
- **Warnings above the message field.** At 80% used, or 3 days left, the field says how much is used and when it
  runs out, and sending goes on. When the stamp ran out, is not usable yet, or Swarm ID gives this site none, the
  field says so, sending is held with what was typed kept, and two buttons offer Change stamp in Swarm ID and Let
  the gateway pay.
- **Also write my own feed.** Off by default, and offered only with My stamp. With it on, every message is first
  copied into the sender's own feed, `ownFeedTopic(chatTopic)` from swarm-chat-js under the chat key's address,
  one entry per message at the next index, stamped by Swarm ID too, and only then sent, so a message that says
  `own: true` always has its copy. swarm-chat-js 8 signs every message with `own: false`, so the page signs it
  again with `own: true`, the same id, time and text. The feed's newest index is read once, through the chat
  history's source, and counted on from there. When it cannot be read, the message waits with the reason rather
  than going out without its copy. Each message then costs two stamped chunks.

**How the page talks to Swarm ID.** The library, `@solarpunkltd/swarm-id` from the Solar Punk fork, is a file
of the bundle of its own, fetched when the page starts on a deployment that offers Swarm ID, because
restoring a session needs it. It embeds a hidden frame of the Swarm ID site, which is why the image's
`SWARM_ID_URL` adds that site to the policy's `frame-src`, and talks to it with `postMessage`. The
window is a window of its own, opened by the frame or by the page, which the policy does not govern.
`config.json` is mounted rather than written by the image, so the site is named twice, and
`SWARM_ID_URL` and `swarmId.url` must be the identical origin. When they differ the policy refuses the
frame, the page offers no sign-in, and the console warns once, naming both settings. It warns the same
when the Swarm ID site does not start for this page at all.
Everything the viewer uses of the library goes through `src/features/chat/swarmId/`, and only
`swarmIdLibrary.ts` there imports it.

**What the Swarm ID site requires.** It serves only the sites on its allow list, an ENS text record
(the fork's `docs/Site-Allow-List.md`), and refuses any other: the library cannot start and the page
offers no sign-in. A site is added by its exact origin, `https://` and the host as the browser reports
it. For local work, a development build of the Swarm ID site also serves the origins named in its
`PUBLIC_SITE_ALLOW_LIST_DEV_ORIGINS`, which may be local http, such as the dev server at
`http://127.0.0.1:5173`. Serve the viewer and the Swarm ID site on different sites, such as the viewer
at `127.0.0.1` and the Swarm ID site at `localhost`. On the same site the frame reads the session from
storage it shares with the Swarm ID site, and a session read that way carries no binding, so the page
says Swarm ID signed in without confirming a chat address and stays signed out. A binding for a local
http site passes only on a page served over local http, as `pageScope` decides for every check.

## Build it

```bash
pnpm build     # typecheck and bundle into dist/
pnpm preview   # serve dist/ locally
```

`dist/` is a static site. Serve it with a fallback to `index.html` and with its `config.json` beside
it, or run the image below, which does both.

The other scripts: `pnpm test` (vitest), `pnpm lint` (oxlint), `pnpm typecheck`, `pnpm format` and
`pnpm format:check` (oxfmt). `pnpm e2e` builds the app and runs the browser journeys in Playwright:
a replayed recording, the theme switcher on that recording, Connect, the weeb-3 journeys, chat messages on the
viewer's own stamp against a fake Swarm ID site on that recording, and real hls.js against a fake gateway publishing a live stream in four
qualities, each answer held back 650 ms. The first run downloads the Chromium build Playwright pins.
Beyond that they need no Bee node and no network, and they print their timings and read rates
without asserting them. Continuous integration runs the format check, lint, typecheck, tests, build and `pnpm e2e` on every
pull request, and reports what the first page load downloads.

`pnpm test` also holds the count of exports nothing else imports at or below the number in
`scripts/unused-exports-baseline.json`. `node scripts/unused-exports.mjs --list` names them, and
after removing one, `node scripts/unused-exports.mjs --write` lowers the baseline so the gain is kept.

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

| Setting              | What it is                                                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GATEWAY_MODE`       | `proxy`, the default: the page reads the gateway at `/bee` on its own origin, so `config.json` names `/bee` as `gatewayUrl`. `direct`: the page reads the gateway at its own address, which `config.json` names   |
| `BEE_GATEWAY_URL`    | Required. The gateway's address, with no path. In proxy mode `/bee` forwards to it. In direct mode the page reads it, which the policy allows at https, and names at plain http                                   |
| `CHAT_READ_URL`      | The chat's read endpoint, the same as `chat.readUrl` in `config.json`. Checked at start, and named in the policy when it is plain http. Leave it out when there is no chat                                        |
| `CHAT_WRITE_URL`     | The chat's write endpoint, the same as `chat.writeUrl`, checked and allowed the same way. The one `CHAT_BEE_URL` of before stops the container                                                                    |
| `EXTRA_GATEWAY_URLS` | Optional. The addresses of the further gateways `config.json` offers in `providers.gateways`, separated by spaces, each with no path. Checked at start, and the plain http ones named in the policy               |
| `SWARM_ID_URL`       | Optional. The Swarm ID site, the identical origin to `swarmId.url` in `config.json`, which the page is then allowed to frame, and which may then read `/bee` in proxy mode. Leave it out when there is no sign-in |
| `config.json`        | Mounted over the image's example at `/usr/share/nginx/html/config.json`. Without it the page shows the example's placeholders as a configuration problem                                                          |

A setting that is missing or malformed stops the container at start, and its log says which one.

### What the page may reach

The policy is the same on every deployment, because the page decides which sources it offers:

- **Any gateway, and a Bee node, at an https address.** `https:` in `connect-src` and `img-src`, so the
  page reads it and shows its pictures. A gateway's address is the viewer's to choose, so no list of
  hosts could hold them all.
- **A Bee node on the viewer's own machine**, at `localhost` or `127.0.0.1`, any port, over plain http,
  in `connect-src` and `img-src`. A policy cannot name `[::1]`, so that address is refused where it is
  typed, with what to type instead.
- **The node in this browser, weeb-3.** `'wasm-unsafe-eval'` in `script-src`, so the page and its
  workers may compile the WebAssembly module, and `wss:` in `connect-src`, so the node can reach its
  peers. That is every secure websocket host, on purpose. The package's mainnet bootnodes are all
  `*.libp2p.direct` names, which `wss://*.libp2p.direct:*` would cover, but the node also dials any peer
  that announces a public DNS name with TLS, and a narrower list would refuse those.

Plain http beyond the viewer's own machine is never allowed, apart from the addresses the image's
settings name, because a browser blocks it from an https page and a policy cannot tell the local network
from the internet. Blob URLs stay media, image and worker sources and are never added to what the page
connects to.

`/weeb-3/` always serves weeb-3's files: the WebAssembly module as `application/wasm`, and its service
worker at `/weeb-3/service.js` with `Service-Worker-Allowed: /`, because the worker answers the node's
`/weeb-3/...` routes for a page anywhere on the site. Every file there is answered `no-cache` and a missing
one is a 404, never the page. weeb-3 keeps every route under `/weeb-3/` at the site's root, so the viewer is
served at the root.

### The release tag and the build label

A `v*` tag publishes the image, built for amd64, as `ghcr.io/solar-punk-ltd/stream-event-client:<tag>`
(`.github/workflows/image.yml`). A deployment pins it by the digest that tag resolves to. No tag ever
moves `latest`.

The workflow passes the tag and its commit into the build as `BUILD_TAG` and `BUILD_COMMIT`, and the page's Copy
diagnostics names the build by them, such as `v1.7.0-rc.5 (1fcfbd4)`. A build without them, such as `pnpm build`
in a checkout, asks git instead: the tag on the commit, an annotated one before a lightweight one, else the nearest
tag behind it and the commits past it, such as `v1.7.0-rc.5+3 (8e2d0aa)`, else the short commit alone, with
`-dirty` added when the tree holds uncommitted changes. With neither, as in a plain `docker build`, which
leaves `.git` out, it says `development build`. A `BUILD_TAG` that is not a plain tag name, letters, digits
and `. _ + / -`, or a `BUILD_COMMIT` that is not hexadecimal stops the build rather than reaching the page.
`scripts/build-label.mjs` holds the rule.

### Testing the image

`pnpm test:image` builds the image and checks it running, in both modes: `nginx -t`, the cache
headers and the policy on each kind of answer, reads and refused writes at `/bee`, weeb-3's files, and the
refusal to start without `BEE_GATEWAY_URL`. It needs a Docker daemon, so it is not part of `pnpm test`. `pnpm test:docker` runs it and then
records the browser smoke test's answers, which is what a job with a Docker daemon runs.

- **Caching.** The page is served `no-cache`, so a browser asks before reusing it after a deploy.
  `config.json` is served `no-store`. The bundle under `/assets/` is named by content hash and kept
  for a year.
- **Content security policy.** The page may reach its own origin, every https address, a Bee node on
  the viewer's own machine at any port, secure websockets for weeb-3, and the plain http addresses the
  image's settings name, as "What the page may reach" says. With `SWARM_ID_URL` set it may also frame
  that one site, for the hidden frame the Swarm ID library talks to, and frame nothing else. Inline styles are allowed because the emoji picker writes its own, and blob URLs because the
  player plays through them, which is also why no gateway is named as a media source. Blob URLs are
  media, image and worker sources only, never a place the page connects to: hls.js reads a playlist
  with a request, so a stream card hands it its preview playlist from memory rather than as a blob.
- **The proxy passes reads only.** `/bee` forwards `GET` and `HEAD`, so the site cannot be used to
  write to the gateway. The chat writes through its own endpoint, `CHAT_WRITE_URL`.

## What the viewer does

- **The stream list.** Read from a Swarm feed and read again once a minute, also after a failed read,
  never on a longer backoff. Until the list has been shown from the source now selected, a failed read
  is tried again after 5 seconds, so a first read that fails, on load or after switching source, does
  not leave the page waiting a minute. Each read asks the list's next slot before it is written, and
  Bee skips each peer asked that early for a minute, so the page asks no more often than that. A new or changed entry therefore reaches an open browse page up
  to a minute after it is written. Once the list has been read, a slow or refused read of the next
  slot means nothing new yet, and a slot whose body does not parse is asked for again rather than
  skipped. Every live stream gets
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
  broadcast. Its watch page says the stream has not started and reads the broadcast's ladder markers,
  each period's marker once, about 4 seconds into the period. Each marker found prompts one read of the
  stream list, and the player starts once the list says live, with the stream's renditions. Apart from
  that the page reads the list once a minute, for a new start time, a title change or an unpublish,
  because asking the list's unwritten next slot more often makes the node skip its peers for that slot
  and the live entry then arrives up to a minute late. If it is unpublished while the page waits, the
  page says it is no longer available.
- **A broadcast that comes back.** After a feed finishes, the player keeps asking for the slot after
  the finished playlist, about every 30 seconds and spread per viewer. When the broadcast returns and
  the viewer has reached the end of what they were playing, the player rejoins it live.
- **The quality ladder.** A stream published in several qualities is one feed per quality plus a
  master playlist on a feed of its own. When the stream list names the stream's renditions, the
  player builds the master from the list and never reads the master feed. hls.js chooses the
  quality, and the player reads only the feed of the quality it plays. A stream turns live once its
  first quality has reported, so a viewer who joins a moment before the others report gets an entry
  naming only some of them, or none. The player compares the entry with the stream's time marker,
  the one it reads at the start anyway and then one per 10 second period for a minute, each address
  once. When a marker names a quality the entry lacks, the watch page reads the stream list's next slot
  once. A quality reports before its first segment, so that slot is written by then and the read is
  not early. The fuller entry rebuilds the player with every quality, which costs the viewer a moment
  of loading. The page never polls the list for this.
- **How far behind live it plays.** The live target is three segments of the playlist's segment
  length, never under 12 seconds, and moves when the playlist names a new length.
- **How it times its reads.** The player asks for the next playlist when it is due: the newest
  segment's end, plus one segment, plus a delay it learns from its own reads, set so that about one
  ask in four comes too early. A second ask covers that one, then one ask per segment, then asks
  every 2 seconds rising to 4 while nothing comes. A playlist 4 seconds late is looked past, one
  slot further on. One viewer costs about 40 reads a minute.
- **When the broadcast goes quiet.** Bee skips, for a minute, every peer it asked for an address not
  written yet, so a slot asked for over and over during an outage stays unreadable for about a minute
  after the broadcaster is back. So once the next slot has had five asks, the player stops asking for
  it and reads the stream's time markers instead (described below), each one once, 4 seconds into its
  10 seconds. When a marker names a slot past the missing one, the player reads that slot, whose
  playlist also holds the segments it skips, and follows on from there. The picture is back 4 to 14
  seconds after the broadcaster has new video, where it used to take about a minute. In a 10 second
  period whose marker is missing, the slot itself is asked once.
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
  read for three of its segments, never under 6 seconds: if it moves on, the player moves to it and drops the stopped one. There is no limit
  on how many are dropped: a quality refused at a switch is dropped too, and the player keeps moving on
  until it is on a quality that moves. The last quality is never dropped. If the next one does not move
  on, the broadcast paused or ended, and the player says so.
- **The end.** The qualities of one broadcast finish moments apart, each as its upload drains. So
  when the playing quality finishes, the next lower one is watched for that whole bound rather than
  to its first new playlist: one that finishes inside them means the broadcast ended, and only one
  that carries on through them is moved to. A quality the player was moved to that finishes before
  hls.js has switched to it runs the same check.
- **A segment that will not load.** When hls.js gives up on one of the three newest segments of a
  live playlist (segments already marked as gaps not counted), the player marks that segment
  `#EXT-X-GAP` in the playlist it serves hls.js. hls.js gives up after its own retries with no other
  quality left to try, or at once on a segment it finds no media in. The video skips that segment's picture,
  about one segment long, instead of freezing or restarting the player, and every later reload of that playlist
  says the same. At most four segments of one stream are skipped this way in any five minutes, and a stream opened
  after another starts with all four. Past that, or for
  an older segment, a finished broadcast or a recording, the player handles the error as it always
  did: hls.js's own skip stands for a segment it gave up on, and a fatal network error restarts the
  player. While another quality is left, a segment that failed to load is tried there instead and
  nothing is marked. The playback quality panel counts each skipped segment once, under Segments
  Skipped, and not as a fatal error or a reconnect attempt.
- **Where the video loads from.** Connect, the button in the header, is described below.
- **Diagnosing playback.** `?qoe=1` on a watch page shows the playback quality panel, ported from
  Nandor Komlodi's panel in the streaming monorepo's client. Its round button toggles it, and so does
  `Q` when you are not typing in a field. The panel lives in the browser window, not in the player:
  drag the button to move it anywhere in the window, and drag any edge or corner to resize it like a
  window, down to 160 by 120 px. Moving and resizing need a mouse, a finger or a pen. The keyboard
  can focus the panel and scroll it, but moving or resizing it from the keyboard is not built yet. It
  opens 250 px wide at the player's top right. It is always kept inside the window with its header,
  or its button when collapsed, in reach, also after the window is resized and when full screen
  starts or ends. Where it was left, its size and whether it was open are remembered in this browser,
  and a place that no longer fits the window is pulled back in. It stays visible and usable in full
  screen: while the panel is on, the video's full screen button puts the whole player in full screen
  rather than the video alone, so the panel can be inside it. This was checked in Chromium only. A
  browser that refuses to move the full screen to the player keeps the video's own full screen, and
  the panel stays in the page, where it may be hidden or not take clicks. Safari on an iPhone always
  plays full screen in its own player, so the panel is not shown there. Copy puts what the panel
  shows on the clipboard as JSON, and Save downloads the same as `qoe-<stream>-<date>-<time>.json`,
  which works where a page served over plain http is refused the clipboard. A value not measured yet
  reads n/a, and a value out of range is marked with a `!` as well as its colour. The line under the
  header names the viewer's build, the same label Copy diagnostics names. `?level=720p` pins one
  quality, which tells a bad quality apart from a bad switch.

## Connect

The button at the right of the header opens Connect (`src/features/connect/Connect.tsx`), a panel at the side of
the window on a wider screen. The button says Connect, or the viewer's chat name with its badge once they chat.
Connect holds who the viewer is in the chat, every source they can read Swarm through, and what each source is
used for. Adding a source and a source's settings open in its place, with a back arrow. Escape goes back one view
the same way, and only Escape on the menu closes Connect. Each new view takes focus to its first field where it has
one, as the address of a gateway or a Bee node, and to its title otherwise. Closing Connect while Weeb3 is being
added asks first, since closing stops that node, with Keep adding and Stop and close. Every change applies at
once and is kept in the browser, and nothing switches a source by itself.

- **ID.** On a site with chat. Not chatting: a guest name with Chat as guest, and Sign in with Swarm ID where the
  deployment offers it, as [The chat](#the-chat) describes. Chatting: the name with its badge and Leave for a guest,
  or the Swarm ID account with Sign out, and the theme switcher where the deployment allows it. Leave asks first,
  since it forgets the name. The chat's own join button opens Connect too.
- **Swarm access.** One list of every source: the gateways `config.json` offers, marked Offered, then the ones the
  viewer added. Each row has a status dot, the name, its kind and address, how long its last light check took, and a
  Settings button. While Connect is open each source gets that light check about every 10 s, the stream list's
  first entry for a gateway and Bee's `/health`, `/readiness` and `/peers` for a Bee node, and nothing is checked
  while it is closed. Add source sits under the list.
- **Use for.** All features reads the video, the stream list, the previews and the chat history from the one source
  picked. Per feature picks a source each for Video, Stream list, Previews and Chat history. Chat messages are always
  sent to `chat.writeUrl`, whichever source reads the chat history. The deployment's default gateway reads its chat
  history at `chat.readUrl`, where it serves the chat's paths, and any other source reads the chat at its own address.
- **Adding a source.** Three tiles: Gateway, a Swarm gateway at an https address, My Bee node, on this computer or
  at an https address, and Weeb3, a Swarm node in this browser tab. A browser has one Bee node of its own and one
  Weeb3, so each tile says Already added once it is. A gateway or a Bee node takes an address and a name, and Test
  connection runs its checks (below). The add button stays disabled until every check passed for the address in the
  field, so nothing is added before, and a new address asks for the checks again. A source that was added is not put
  in use: the viewer picks it under Use for.
- **Weeb3.** Opening its tile starts the node and shows its download, against the 2.2 MB module, and its peers out of
  200, the healthy target, with "Playback can start before that." Its checks run at once, and Add Weeb3 waits for
  them. When they did not pass, Test again runs them once more, and starts the node again first if it failed. It serves the video only for now: Use for offers it for Video per feature, and greys it with "Video only for
  now" for all features and for every other part. A saved setting that puts it on another part reads that part from
  the default instead. Its row shows how far the node has got: the download, then "Starting", "Connecting, N of 200
  peers", and once ready "N of 200 peers", or "Failed to start".
- **The checks.** Each kind runs its own, in this order, each line with ✓, ✕ or – and its time. The first that fails
  stops the rest, which show –, and a box under them says what is wrong and what to fix, such as "Not added. It does
  not allow this site (CORS)." and "Its operator has to add this site to Bee's cors-allowed-origins." For a Bee node
  of the viewer's own that box also gives the exact `cors-allowed-origins` lines for this page's origin, or how to
  undo a refusal of the browser's local network question (`src/features/gateway/sourceChecks.ts`, its words in
  `checkWords.ts`).

  | Check                                            | Kind         | How it is measured                                                                                                       |
  | ------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------ |
  | Answers over https                               | gateway      | The address is https, or on this computer, and the stream list's first entry is asked. Any answer is one                 |
  | Answers, on this computer or at an https address | Bee node     | The address is on this computer or https, then the same read                                                             |
  | Allows this site (CORS)                          | gateway, Bee | That answer could be read by this page. A refusal is told from nothing there by a second request without CORS            |
  | Bee 2.6 or later                                 | gateway      | `/health`'s version. A gateway that does not state one passes with "not stated", one that states an older release fails  |
  | Bee 2.6 or later, ready                          | Bee node     | `/health`'s version, `/readiness` and `/peers`, so a node still starting or with no peers fails                          |
  | Node started                                     | Weeb3        | Its module downloaded and the node running, waited for as long as its own deadlines allow                                |
  | Connected to 20 peers                            | Weeb3        | Its peer count, waited for up to a minute                                                                                |
  | Reads a chunk                                    | every kind   | The root chunk of a segment of this event's video, read the way the chat history reads its slots, through its chat route |
  | Reads bytes                                      | every kind   | The same segment's bytes, read the way the player reads it                                                               |
  | Reads this event's stream list                   | every kind   | The stream list feed's head, which it must parse as a stream list. Weeb3, with a slow head search, reads its first entry |

  The segment comes from the stream list the page shows, a live stream first, else the newest with video, and its
  playlist is found as the player finds it. A stream's picture stands in where no stream has video yet.

- **A source's settings.** Its name and address, Test connection, which runs the same checks again, and the last
  light check's time until then. A source the event offers says "Offered by this event. It cannot be changed or
  removed." and its fields are read only. An added source's name can be changed, its address cannot, and Remove takes
  it out, every part that read from it moving to the default gateway. Weeb3's settings show its peers, its network
  and the weeb-3 build. Copy diagnostics is there for every source.
- **No fallback.** A part reads from the source picked for it and from nothing else, whatever that source answers.
  The player's own retries ask the same source again.
- **A source that fails.** When a part's reads, or the segments and pictures loaded for it, have had no answer it can use for 10 s, a bar under the header says
  so, such as "Video cannot load from Event gateway." and "No answer for more than 10 s.", with a Choose another source button
  that opens Connect. One bar per failing part, gone at the part's next answer, or 30 s after it stopped reading. A not
  found is an answer, so a chat slot not written yet never shows one. The watch page names the video's source above
  the player, such as "via Event gateway".
- **Copy diagnostics.** The last checks of that source, who answered each part in the last minute, the build and the
  browser. The build is named by its release tag and short commit, such as `v1.7.0-rc.5 (1fcfbd4)`, as "The release
  tag and the build label" under "Run the image" says. It holds no address but the checked source's.

What the browser keeps, in `localStorage`, every read and write guarded so a refusal leaves the
deployment's defaults for that visit:

| Key                 | What it holds                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `swarm-sources`     | The sources the viewer added: id, type (`gateway`, `bee-node` or `weeb-3`), name, address, none for `weeb-3` |
| `swarm-routing`     | All features or per feature, the source picked, and each part's source                                       |
| `swarm-gateway-url` | The one address saved before sources existed. Read once and moved, then removed                              |

An address saved under `swarm-gateway-url` that an offered gateway has becomes a choice of that
gateway. Any other becomes an added Bee node named "My Bee node", in use, so a viewer keeps reading
where they read before.

## The node in this browser (weeb-3)

weeb-3 (`@lat-murmeldjur/weeb_3`) is a Swarm node compiled to WebAssembly that runs inside the viewer's tab, so a
viewer can watch without any gateway. A page runs one node, behind a shared worker, and everything that uses weeb-3
shares it (`src/swarm/providers/weeb-3/weeb3Runtime.ts`). It is ready once it has a peer and its service worker
controls the page, and counts as failed when it is not ready after 30 s.

- **Loaded only when picked.** The package is imported from one module, `weeb3Module.ts`, as a chunk of its own,
  so the first page load carries none of it. The build copies the package's browser files, its service worker,
  shared worker and WebAssembly module, to `/weeb-3/` (`scripts/weeb3-files.mjs`). The bundle carries no copy of
  the module of its own.
- **When it runs.** The node runs while something holds it: the video while weeb-3 is its source, the watch page's
  player while it shows, Connect from adding it until Connect closes, or a source's settings while it is checked
  there, and every read through it while that read runs. A read made while the node is starting waits for it to be
  ready, and one made while it is stopped starts it first, so a part never gets an early answer from a node that is
  not there yet. A node that fails to start answers the read as unavailable. Listing a saved one starts
  nothing. When the last of them lets go, as when the video moves to another source or the source is removed, the
  node is stopped and freed.
- **Getting ready.** The page downloads the 2.2 MB WebAssembly module itself, reading it as it streams, so the
  row in Connect and the watch page can show how much has arrived against the length the server names. A
  download that has not finished after 60 s, or whose package fails to load, is stopped and the node counts as
  failed. It hands the bytes to the package, then reports starting, then connecting with its peers counted against 200,
  weeb-3's own connection target (`CONNECTION_BUILDUP_LIMIT` in its `src/accounting.rs`, which its project README
  says drops to four fifths for every 100 lost connections, down to 30). The node is ready at its first peer, so
  the video does not wait for the rest, and the count keeps building up after that.
- **The video, in weeb-3's own player.** With weeb-3 as the video's source the watch page plays the stream with
  weeb-3's player, bare: a video element with the browser's controls and weeb-3's own choice of quality, from the
  newest entry for a live stream and the beginning for a finished one, and none of this app's overlays or `?level=`.
  One quiet line under the player, never over the video, shows the download, then the peers out of 200 with the
  same note under 200, for as long as weeb-3 plays. The stream is attached once the node is ready. Nothing replaces weeb-3's player: one whose node fails, or that cannot attach, says "The Swarm node in this browser could not play this stream." and stays. weeb-3's limits
  are its own: it plays about 16 s behind live, does not leave a quality that stopped, does not notice a broadcast
  that returns, and plays one stream across the browser's tabs.
- **No switching.** A part that reads from weeb-3 reads from it alone, as every part reads from its own source alone.
  None of its reads is handed to another source whatever it answers. Every read through it gets weeb-3's
  own 30 s budget rather than the client's 10 s, so a missing chunk, which weeb-3 gives up on after about 17 s, ends
  as not found rather than cut short.
- **Reads.** weeb-3 reads through its service worker's routes: `/weeb-3/chunks/` for a chunk, a feed entry or a
  single-owner chunk, `/weeb-3/bytes/` for bytes, and segment URLs on its caching route `/weeb-3/hls/bytes/`. weeb-3
  puts a chunk's 8-byte span before bytes and before a single-owner chunk's payload, which Bee leaves out, so it is
  taken off. A feed's head, which weeb-3 has no lookup for, is found by reading the feed's entries by index, eight at
  a time: entry 0 and every power of four less one, then wider steps past the newest entry found until one misses,
  then even cuts of the gap until the newest entry and the missing one above it touch. A miss costs weeb-3 about
  17 s, so a head read takes a few of those, about a minute for a feed of a few hundred entries, and the answer it
  gives is always an entry read with the one above it read missing. A single-owner chunk read by its address answers
  unsupported, and plainly, since nothing else is asked: it comes back without the identifier and signature that
  prove it the owner's, as the chat's slots are read. That is out of reach while weeb-3 serves the video only, since
  the chat never reads from it.
- **Stopping, as far as it goes.** Stopping frees the page's handle on the node, and with 0.0.354001 that leaves the
  node in the package's shared worker running: a handle made after a stop still finds its peers. The package names
  no way to stop that worker's node, so it lasts until the browser closes the worker with the tab.
- **The live proof.** `pnpm proof:weeb3` builds the app and, on the public Swarm network, adds the node in a real
  browser, picks it for the video, waits for it to be ready, plays a finished stream from its beginning, checks that
  `/weeb-3/bytes/` carries exactly the 8-byte span `/weeb-3/hls/bytes/` leaves out, and asks the shared worker for
  its peers after the stop. It prints what it saw and is never part of `pnpm e2e`. Its default stream is a public
  test stream run by weeb-3's author, and `WEEB3_PROOF_OWNER` and `WEEB3_PROOF_TOPIC` name another.

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
  written into the playlist or the page, not read through the client. Each load's outcome is still
  reported to the client (`reportUrlLoad`): a segment hls.js loads or fails for the video, and a preview
  segment or a picture for the previews, so a source that serves feeds and fails every segment shows the
  failure bar. A failed one is asked again of the same source by hls.js. `fetchSegmentBytes` is the one place segment
  bytes are fetched, where a provider without URLs can plug in.
- **ManifestStateManager** merges each live playlist into a growing EVENT playlist, so segments stay
  playable longer than the publisher's sliding window.
- **LadderFeedPoller** follows the feed of the quality hls.js plays, plus the one being switched to
  during a switch. A quality left behind forgets where it was, so coming back to it starts at its
  newest playlist. Where it starts comes from a `NewestIndexFinder`, injected so it can be swapped:
  the `MarkerFinder`, which reads the ladder's time marker (`src/shared/ladderMarker.ts`, copied from
  the uploader) and falls back to the `IndexSearchFinder`. How it follows is `followPredicted` in
  `src/features/player/following/`, the polling study's choice. The player assumes no segment length:
  the follower and the searches take it from the `#EXTINF` values of the playlist they stand on, and a
  join from a time marker takes the `segmentMs` the marker names, which is the stage's `HLS_FRAGMENT`. The study's simulator and the strategies it was compared with are in `test/feedModel/`.

Feed URIs use a `swarm://<owner>/<topic>` scheme, because hls.js resolves every playlist URI against
the playlist's own URL and a URI with a scheme is the one case it leaves untouched.

## The Swarm client

`src/swarm/` is the one layer that reads Swarm, plain TypeScript with no React, and it imports nothing
from `src/app` or `src/features`. The features and the app read only through it: a test fails on a line
there that builds a Bee URL, calls fetch, or makes a Bee client of its own, and on an import of anything
in `src/swarm` beyond the client's public surface, `client`, `answers`, `provider`, `settings` and
`createSwarmClient` (`test/swarm/boundary.test.ts`). The chat's write and its single-owner chunk codec are
the two named exceptions, each with its reason in the test.

- **Where each feature reads.** `AppProvider` makes one client at start from `config.json` and the
  viewer's saved sources, and makes it again when the viewer changes what a part reads from.
  Components get it from the app
  context. The player reads through `reader('player')`, the stream list through `reader('stream-list')`,
  the previews and pictures through `reader('previews')`, Connect checks a source through a
  client made for that source alone, and the chat reads through `reader('chat')`, on the source picked for the
  chat history.
- **The chat.** swarm-chat-js 7.3.0 is handed a source and a write in place of its own Bee client
  (`src/features/chat/chatParts.ts`). The source makes the library's own reads at the same URLs: the
  feed head, each slot and note as a single-owner chunk checked to be the chat owner's
  (`src/swarm/singleOwnerChunk.ts`), and history files as bytes. A 404 and a 500 both mean a chunk is
  not there, as the library rules. A message is written exactly as the library writes it, to
  `chat.writeUrl`, because it costs a stamp the viewer does not hold.

- **A provider** is one way of reaching Swarm (`src/swarm/provider.ts`), holding only what the app reads:
  a feed's head, a feed entry by index, a single-owner chunk's payload by its owner and identifier (a
  feed entry is one, and so is a ladder's time marker), a chunk, the bytes a reference names, and a URL
  for what the browser or hls.js loads itself. It also has its status, a probe, and start and stop
  for a node in the tab. `src/swarm/providers/bee-http/` is Bee's HTTP API, asking the paths the app has
  always asked.
- **Every read answers and never throws** (`src/swarm/answers.ts`): the content, with the feed index
  and the server time where the answer carries them, not found, rate limited with the wait asked for,
  unsupported, unavailable with its cause (a timeout, a status or no answer at all), or aborted. Every
  read takes a signal and a window, ten seconds when none is given. Bee's 404 is not found, its 429 is
  rate limited with its `Retry-After` capped at a minute, and any other failing status, a 500 included,
  is unavailable. A chunk read is the exception: Bee answers 500 for a chat slot never written, which an
  idle chat asks for on every poll, so there a 500 is not found.
- **The client** (`src/swarm/client.ts`) is made from the settings and the viewer's choice by
  `createSwarmClient`, which makes each gateway's provider through the registry of kinds
  (`src/swarm/registry.ts`). Each feature (the player, the stream list, the previews, the chat) reads
  through its own provider and through nothing else. A read that fails answers as it failed, and the
  feature's own retry, such as the player's backoff, asks the same provider again. URLs come from the
  feature's own provider, and a playlist the player already holds names its segments again at a switch of
  node. Every read is counted by feature, kind, provider and answer, and `activity()` gives the last
  minute's answers per feature, which the diagnostics carry. The server time of the player's and the
  stream list's answers keeps the gateway clock, and the chat's, read from the chat's own host, does not.
- **The contract** (`test/swarm/providerContract.ts`) is the suite every provider kind must pass, run
  for Bee over HTTP against the answers the browser smoke test replays.

## The design

Two themes. `swarm` is Swarm Brand v3.0 as msrs-client's Swarm theme draws it: near-black surfaces, the
Swarm orange `#f47a20` as a sparing accent and Geist for all text. `web3privacy` is web3privacy.info's: a
black page, the neon green `#70ff88`, Archivo for text and Domine for headings. Both use JetBrains Mono
only for the configuration problem's detail and the playback quality panel. A deployment picks its
theme in `config.json`, and a logged-in viewer can switch the look, as above.

- **The tokens.** The scales (sizes, spacing, type steps, radii, timing) live in
  `src/design/_tokens.scss`, one Sass map per group. What a theme decides, its colours and typefaces,
  lives in `src/design/themes/`, one file per theme, each merged over `themes/_base.scss`, which holds
  what every theme shares. `src/design/theme.scss` emits the scales once on `:root` and each theme under
  `:root[data-theme='<name>']`, the default theme on a bare `:root` too, and under
  `[data-theme-preview='<name>']` for an element that shows one theme whatever the page wears,
  as CSS custom properties named `--<group>-<name>`, for example `--color-primary` or
  `--spacing-base`. It also sets the page's base styles.
- **Components read only the variables**, `var(--color-primary)`, never a Sass token or a literal
  colour, so a switch of the look reaches every part of the page. The tokens test refuses a colour a
  stylesheet outside `src/design/` writes out. The breakpoints are the one exception, because a media query cannot read a custom
  property: they are the mixins in `src/design/_media.scss`, and every layout is written for a phone
  first and widened by them.
- **To add a token**, add a scale to its map in `_tokens.scss`, or a colour or typeface to every
  theme in `src/design/themes/`, and read it where it is needed. The tokens test
  (`test/designTokens.test.ts`) fails when a stylesheet reads a variable the design does not define,
  when the design defines one nothing reads, when one theme lacks a variable another has, and when a
  text colour falls below 4.5:1 against its background. A new colour pairing goes into its list too.
- **The fonts** are bundled from `@fontsource`, only the weights used: Geist 400, 500, 600 and 700,
  Archivo 300 to 700, Domine 400 and JetBrains Mono 500, imported in `src/design/fonts.ts`. A browser
  downloads a typeface only when text on the page is set in it, which the switcher's swatches do for each
  theme's heading typeface once the menu is open. The page makes no font request to a
  third party. Another weight needs its file imported there, or the browser fakes it.

## Layout

```
src/
  app/          the entry, routes, the app provider, the page layout and header
  config/       the runtime configuration, read and checked at start
  design/       the design tokens, the themes' looks and content, the fonts and the logos
  features/
    catalog/    the stream list: feed reader, schema, polling, previews
    player/     the Swarm HLS player, its loaders and overlays, the watch page
    connect/    Connect, the panel the header opens: the ID, the sources, Use for, and the failure bar
    gateway/    a source's checks, its light status, the address rules and the diagnostics
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
