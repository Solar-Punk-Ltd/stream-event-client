# stream-event-client

A web app for watching an event's live streams and recordings over [Swarm](https://www.ethswarm.org), with a chat
beside each stream. Browse the event's streams, watch one, choose and test where each part of the page loads from
(the event gateway, another gateway, your own Bee node, or Weeb3, a Swarm node that runs in the browser tab), and
chat as a guest or signed in with Swarm ID, with the event paying for each message or a stamp of your own.

It is a static page: one build serves every deployment, and everything a deployment differs by is a setting in
`config.json`. The page holds no keys and no stamps. It was built from the viewer of
[streaming-monorepo](https://github.com/Solar-Punk-Ltd/streaming-monorepo) and the Swarm design and chat of
[msrs-client](https://github.com/Solar-Punk-Ltd/msrs-client).

## Features

- **The stream list**, read from a Swarm feed: live streams featured, the next upcoming one with a countdown, then
  upcoming and past streams, with search and paging. A change reaches an open page within a minute.
- **A player that reads only the quality it plays**, finds the newest playlist from the ladder's time markers, follows
  the feed as it grows, skips a segment that will not load, rejoins a broadcast that comes back, and keeps your place
  in a recording when you switch source.
- **A chat per stream** on `@solarpunkltd/swarm-chat-js`: guests with a display
  name, Swarm ID sign-in, every message verified before it is shown, reactions, threads, and verified ENS names.
- **Who pays**: the event gateway stamps each message, or, once signed in with Swarm ID, your own stamp, sent through
  your own Bee node or Weeb3, with a copy in your own feed that anyone can check against the chat.
- **My Swarm**: every source you can read Swarm through, each checked before it is added, and Use for, which says
  which source each part reads from. Nothing ever switches source by itself.
- **Weeb3**, a whole Swarm node in the tab, as the source of the video with its own player, and a way to send chat
  messages on your own stamp.
- **Two themes**, `swarm` and `web3privacy`, with a switcher for viewers in the chat.

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

| Field           | What it is                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `gatewayUrl`    | The event gateway: a path on this site such as `/bee`, or an http or https address of a Bee node. Set this or `providers`, not both         |
| `providers`     | Optional in place of `gatewayUrl`: the gateways offered (`gateways[]` with `id`, `kind: "bee-http"`, optional `label`, `url`) and `default` |
| `catalog.owner` | The Ethereum address that owns the stream list feed                                                                                         |
| `catalog.topic` | The stream list feed's topic, as text                                                                                                       |
| `chat`          | Optional. `enabled`, `readUrl`, `writeUrl`, `gsocResourceId`, `gsocTopic`, `feedOwner`, `pollIntervalMs`. Without it there is no chat       |
| `theme`         | Optional. `swarm` (the default) or `web3privacy`                                                                                            |
| `themeSwitcher` | Optional. Whether a viewer in the chat may switch the look, `true` by default                                                               |
| `swarmId.url`   | Optional. The Swarm ID site viewers may sign in with, an origin such as `https://id.example.com`                                            |
| `ensRpcUrl`     | Optional. An Ethereum mainnet JSON-RPC endpoint the page reads senders' ENS names through                                                   |

Every field, the `chat` and `providers` blocks in full, what each refusal says and how the theme switcher behaves are
in [docs/configuration.md](docs/configuration.md). Serve `config.json` with `Cache-Control: no-store`.

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

| Script                                             | What it runs                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm test`                                        | The vitest suites, including the Swarm boundary, the design tokens and the unused-exports ratchet  |
| `pnpm e2e`                                         | Builds, then the Playwright journeys in a real browser against recorded answers and a fake gateway |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | oxlint, tsc for the app and `e2e/`, oxfmt                                                          |
| `pnpm e2e:record`                                  | Records the Bee answers the smoke test replays. Needs Docker and ffmpeg                            |
| `pnpm proof:weeb3`                                 | The live proof of weeb-3 on the public network. Opt-in, never in CI                                |
| `pnpm test:image`                                  | Builds the Docker image and checks it running. Needs a Docker daemon                               |

Continuous integration runs the format check, lint, typecheck, tests, build and `pnpm e2e` on every pull request.
Browser suites print their timings and never assert them. The details are in
[docs/handover/development.md](docs/handover/development.md).

## Documentation

Start with the [handover](docs/handover/README.md), five pages for a developer new to the repository:
[overview](docs/handover/overview.md), [architecture](docs/handover/architecture.md),
[components](docs/handover/components.md), [specs](docs/handover/specs.md) and
[development](docs/handover/development.md).

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
