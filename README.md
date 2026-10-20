# stream-event-client

A web app for watching an event's live streams and recordings over [Swarm](https://www.ethswarm.org), with a chat
beside each stream. Browse the event's streams, watch one, choose and test where each part of the page loads from
(the event gateway, another gateway, your own Bee node, or Weeb3, a Swarm node that runs in the browser tab, the
package is weeb-3), and chat as a guest or signed in with Swarm ID, with the event paying for each message or a stamp
of your own.

It is a static page: one build serves every deployment, and everything a deployment differs by is a setting in
`config.json`. The page holds no keys and no stamps.

The Swarm words these docs use, feed, stamp, gateway, part and the rest, are explained in the
[glossary](docs/handover/stack.md#words-used-across-these-docs).

## Features

- **The stream list**, read from a Swarm feed: live streams featured, the next upcoming one with a countdown, then
  upcoming and past streams, with search and paging. A change reaches an open page within a minute.
- **A player that reads only the quality it plays.** It finds the newest playlist from the markers the uploader
  writes, follows the feed as it grows, skips a segment that will not load, rejoins a broadcast that comes back, and
  keeps your place in a recording when you switch source.
- **A chat per stream** on `@solarpunkltd/swarm-chat-js`: guests with a display name, Swarm ID sign-in, every message
  verified before it is shown, reactions, threads, and verified ENS names.
- **Who pays**: the event gateway stamps each message, or, once signed in with Swarm ID, your own stamp, sent through
  your own Bee node or Weeb3, with a copy in your own feed that anyone can check against the chat.
- **My Swarm**: every source you can read Swarm through, each checked before it is added, and Use for, which says
  which source each part reads from. Nothing ever switches source by itself.
- **Weeb3**, a whole Swarm node in the tab. It is offered for the video, with its own player, and for sending chat
  messages on your own stamp. Its player shows the node's peers and the quality playing, with a Quality picker that
  starts on By peers.
- **Two themes**, `swarm` and `web3privacy`, with a switcher for viewers in the chat.

## Experimental: your own way into Swarm, and Swarm ID

Two parts of this viewer are experiments, offered beside the defaults. A viewer who never opens them watches and chats
like anyone else: through the event's gateway, as a guest with a display name.

- **Swarm access.** In My Swarm, a viewer can read the streams and the chat through another gateway, their own Bee
  node, or Weeb3, a Swarm node running in the browser tab, and pick a source for each part under Use for. The aim is
  that watching an event on Swarm does not depend on the event's own servers. Anyone with a Bee node, or only a
  browser, can reach the same content.
- **Swarm ID.** Signing in with Swarm ID gives a person a chat identity they hold themselves, verified on every
  message, and lets them pay for their messages with their own postage stamp. Swarm ID is a separate experimental
  project, Solar Punk's fork of swarm-id, in [Solar-Punk-Ltd/solarpunk-id](https://github.com/Solar-Punk-Ltd/solarpunk-id).
  This viewer only uses it.

We offer both to learn how decentralised access and identity hold up with real viewers, and feedback in the chat is
welcome. A deployment can turn both off with `experimental: false` in its config
([Configuration](docs/configuration.md#the-experimental-switch)).

## Quick start

You need Node.js 24 or later. pnpm comes through Corepack, at the version `package.json` names.

```bash
corepack enable
pnpm install
pnpm dev
```

The dev server opens at `http://localhost:5173`. Before it shows any streams, fill in `public/config.json`. The dev
server forwards `/bee` to a Bee node on this machine at `http://127.0.0.1:1633`, so a config whose `gatewayUrl` is
`/bee` works without the node allowing the page's origin. Set `DEV_BEE_PROXY_TARGET` to forward it somewhere else.

## Configuration

Every setting is read from `config.json`, served beside the page, when the app starts. The repository's
`public/config.json` is an example with placeholders, and the page refuses to start on a value still in
`<angle brackets>`, naming the field. Real values live with the deployment, never here.

Every field, the `chat` and `providers` blocks, what each refusal says and how the theme switcher behaves are in
[docs/configuration.md](docs/configuration.md). Serve `config.json` with `Cache-Control: no-store`.

## Build and run the image

```bash
pnpm build     # typecheck and bundle into dist/
pnpm preview   # serve dist/ locally
```

`dist/` is a static site. Serve it with a fallback to `index.html` and with its `config.json` beside it, or run the
image, which does both: nginx serving the page, the gateway proxied at `/bee`, and a content security policy written
from its settings at start.

```bash
docker build -t stream-event-client .
docker run -p 8080:80 \
  -e BEE_GATEWAY_URL=https://gateway.example.com \
  -e CHAT_READ_URL=https://chat-read.example.com \
  -e CHAT_WRITE_URL=https://chat-write.example.com \
  -v "$PWD/config.json:/usr/share/nginx/html/config.json:ro" \
  stream-event-client
```

The settings (`GATEWAY_MODE`, `BEE_GATEWAY_URL`, `CHAT_READ_URL`, `CHAT_WRITE_URL`, `EXTRA_GATEWAY_URLS`,
`SWARM_ID_URL`), what the page may reach, caching, the release tag and the build label are in
[docs/image.md](docs/image.md). A `v*` tag publishes the image as `ghcr.io/solar-punk-ltd/stream-event-client:<tag>`.

## Tests

`pnpm test` runs the vitest suites, `pnpm e2e` builds and then runs the Playwright journeys in a real browser, and
`pnpm lint`, `pnpm typecheck` and `pnpm format:check` run oxlint, tsc and oxfmt. Continuous integration runs all of
them, and the build, on every pull request. Browser suites print their timings and never assert them. Every script,
every suite and the CI jobs are in [docs/handover/development.md](docs/handover/development.md).

## Documentation

Start with the [handover](docs/handover/README.md), six pages for a developer new to the repository:
[overview](docs/handover/overview.md), [the whole stack](docs/handover/stack.md),
[architecture](docs/handover/architecture.md), [components](docs/handover/components.md),
[specs](docs/handover/specs.md) and [development](docs/handover/development.md).

Then the topical pages, as the work needs them:

| Page                                                   | What it covers                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [Configuration](docs/configuration.md)                 | Every `config.json` field, the chat and providers blocks, the theme switcher        |
| [The stream list and the player](docs/player.md)       | The browse page, the watch page, the quality ladder, how the player reads Swarm     |
| [The chat](docs/chat.md)                               | Guests, the services it needs, verification, badges, a message's details and Verify |
| [Swarm ID](docs/swarm-id.md)                           | Signing in, the wallet link and ENS names, how the page talks to the Swarm ID site  |
| [Who pays for a message](docs/own-stamp.md)            | Gateway pays or My stamp, which source sends, the own-feed copy and Sync            |
| [My Swarm](docs/my-swarm.md)                           | The panel, Use for, adding a source, the checks, what the browser keeps             |
| [The node in this browser](docs/weeb3.md)              | weeb-3: loading, readiness, lost peers, its player, its reads, the live proof       |
| [The Swarm client](docs/swarm-client.md)               | Providers, kinds, source types, answers, the client, routing, the contract          |
| [Extending the providers](docs/extending-providers.md) | Adding a new kind of source to My Swarm, with every file it touches                 |
| [The design](docs/design.md)                           | The two themes, tokens, variables, fonts                                            |
| [The image](docs/image.md)                             | The Docker image, its settings, the content security policy, the release tag        |

The rules for working in this repository are in [AGENTS.md](AGENTS.md).

## Licence

MIT, see [LICENSE](LICENSE).
