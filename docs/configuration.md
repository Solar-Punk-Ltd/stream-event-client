# Configuration

Every setting is read from `config.json`, served beside the page, when the app starts. One build serves every
deployment, and a setting changes without a rebuild. A page that cannot read its config, or finds a value it refuses,
says which field is wrong instead of showing an empty list. The schema is `src/config/runtimeConfig.ts`, and
`test/runtimeConfig.test.ts` covers every refusal below.

The repository's `public/config.json` is an example with placeholders. The page refuses to start on a value still in
`<angle brackets>`, so the example can never pass for a real deployment. Real values live with the deployment, never
in this repository.

Serve `config.json` with `Cache-Control: no-store`, so a changed setting reaches every page opened after the change.
The page itself fetches it with `cache: 'no-store'`. The image does both, see [the image](image.md).

## The fields

| Field           | What it is                                                                                                                                                                                                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gatewayUrl`    | The event gateway: a path on this site such as `/bee`, which the site proxies to Bee, or an http or https address of a Bee node. Set this or `providers`, not both                                                                                                                                                    |
| `providers`     | Optional in place of `gatewayUrl`. The gateways offered and the default, [below](#the-providers-block)                                                                                                                                                                                                                |
| `catalog.owner` | The Ethereum address that owns the stream list feed                                                                                                                                                                                                                                                                   |
| `catalog.topic` | The stream list feed's topic, as text                                                                                                                                                                                                                                                                                 |
| `chat`          | Optional. The chat's settings, [below](#the-chat-block). Without it, or with `enabled` false, there is no chat anywhere on the page                                                                                                                                                                                   |
| `theme`         | Optional. Which of the build's themes the page wears, `swarm` by default. A name the build does not carry is refused                                                                                                                                                                                                  |
| `themeSwitcher` | Optional. Whether a viewer logged in to the chat may switch the colours and typefaces between the build's themes, `true` by default                                                                                                                                                                                   |
| `swarmId.url`   | Optional. The Swarm ID site a viewer may sign in to the chat with, an origin such as `https://id.example.com`, with no path and no trailing slash. Without it, or without a chat, there is no sign-in                                                                                                                 |
| `ensRpcUrl`     | Optional. An Ethereum mainnet JSON-RPC endpoint, an https address, or http on `localhost`, `127.0.0.1`, `[::1]` or a `.localhost` name, with no user name or password in it, that the page reads senders' ENS names through ([ENS names](swarm-id.md#ens-names)). Without it, or without a chat, no name is looked up |

Unknown keys are ignored. A deployment written for an earlier release may still name `providers.fallback`,
`providers.kinds`, `providers.beeNodes` or a `weeb3` block, and the page reads none of them.

## The chat block

With `enabled` true every field must be filled in, and the page refuses to start otherwise. With `enabled` false the
other fields are not read.

| Field                 | What it is                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chat.enabled`        | Whether the page has a chat                                                                                                                                              |
| `chat.readUrl`        | Where the chat's feed and history files are read: a path on this site or an http or https address                                                                        |
| `chat.writeUrl`       | Where chat messages are written, an endpoint that stamps each write: a path on this site or an http or https address. The one `chat.beeUrl` of before is refused         |
| `chat.gsocResourceId` | 32 bytes as 64 hex digits: the key every viewer writes chat messages with. Shared by design and public, not a secret ([why](chat.md#why-gsocresourceid-is-not-a-secret)) |
| `chat.gsocTopic`      | The topic of the address the chat aggregator listens on                                                                                                                  |
| `chat.feedOwner`      | The Ethereum address that writes the chat feeds, which is the aggregator's                                                                                               |
| `chat.pollIntervalMs` | How often an open chat reads its feed, in milliseconds. A positive whole number, raised under load without a rebuild                                                     |

What the chat needs outside this repository, and what each setting reaches, is in [the chat](chat.md).

## The providers block

The `providers` block names more than one way of reaching Swarm. A config that names only `gatewayUrl` is read as one
Bee gateway and the default, so a deployment written before `providers` needs no change. Nothing switches source by
itself: a part reads from the source the viewer picked and from nothing else, and when that source fails the page says
so and the viewer picks another. The chat history is read from the source picked for it, and the default gateway's at
`chat.readUrl`.

The page's policy allows every https address, so a gateway in `providers.gateways` at an https address needs nothing
more. One at a plain http address must also be named in the image's `EXTRA_GATEWAY_URLS` ([the image](image.md)), or
the policy refuses it, unless it is the image's own `BEE_GATEWAY_URL` in direct mode.

The page, not the deployment, decides which types of source a viewer may add: a gateway at an https address, a Bee node
on this computer or at an https address, and the node in this browser. No setting turns a type on or off.

| Field                       | What it is                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `providers.gateways`        | The gateways offered, at least one. Each has an `id`, a `kind`, an optional `label` and its own settings        |
| `providers.gateways[].kind` | `bee-http`, a Bee node's HTTP API, the only kind a deployment may offer as a gateway. Any other kind is refused |
| `providers.gateways[].url`  | For `bee-http`: a path on this site such as `/bee`, or an http or https address, as `gatewayUrl` takes          |
| `providers.default`         | The `id` of the gateway every reader starts on                                                                  |

Two gateways with one `id` are refused, and so is a `default` that names no gateway. A gateway with no `label` is
shown as "Event gateway" when it is the default and as "Gateway <id>" otherwise (`gatewayName` in
`src/swarm/settings.ts`).

## Themes and the theme switcher

A theme has two halves. Its look, the colours and typefaces, is in `src/design/themes/`. Its content, the logo, the
hero, the footer links and the tab's title and icon, is in `src/design/themes.ts`. The deployment's `theme` decides
both. Every theme defines the same variables, so a page that wears another theme's look leaves nothing unset, and the
tokens test fails on a theme that misses one or on a text colour below 4.5:1. The themes themselves are described in
[the design](design.md).

A viewer in the chat finds a Theme group under their ID in My Swarm, one option per theme with a swatch of its page
colour, accent and heading typeface. The arrow keys move the pick within the group, and Tab reaches it at the checked
option. A pick changes only the look. The logo, the words and the tab stay the deployment's, so a Devcon page in the
web3privacy look still says Devcon. The pick is kept in this browser under `viewer-theme`, through reloads and after a
logout, and on the next visit it is worn before the page renders, while the config is still loading
(`src/app/themeChoice.ts`, `src/app/App.tsx`). A deployment without chat has no login, so it has no switcher either,
and one with `themeSwitcher` false keeps a viewer's earlier pick without wearing it.

## How the config is read

`loadRuntimeConfig` in `src/config/runtimeConfig.ts` fetches `./config.json` relative to the page, because the app is
built with `base: './'` and may be served under a path. It never rejects: a file that cannot be read, is not JSON, or
fails the schema comes back as a problem, and `src/app/ConfigProblem.tsx` shows it as "This page cannot start" with the
field and the reason, such as `catalog.owner: must be an Ethereum address`. Nothing else renders until the config is
good.

The schema file imports its two dependencies by file name, with the `.ts` extension, so Node can read it without the
bundler, which is how a deployment's own tests can check a config before deploying it.
