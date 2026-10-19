# Handover

What a developer new to this repository reads, in this order. Each page is short and points at the code and at the
topical pages under `docs/` for the detail.

1. [Overview](overview.md): what the app is, what a viewer does, what runs where, and how a request flows.
2. [Architecture](architecture.md): the folders and what each owns, the import direction and the Swarm boundary test,
   the app shell, the runtime config, the Swarm client, state and browser storage.
3. [Components](components.md): every feature with its main components, hooks and modules, one line each.
4. [Specs](specs.md): the behaviour the app guarantees, each with the file that enforces it and the test that covers
   it.
5. [Development](development.md): run, test, lint, typecheck, the ratchets, the image, CI and release tagging.

Then the topical pages, as the work needs them:

| Page                                                 | What it covers                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [Configuration](../configuration.md)                 | Every `config.json` field, the chat and providers blocks, the theme switcher, how it loads  |
| [The stream list and the player](../player.md)       | The browse page, the watch page, the quality ladder, markers, the loaders, a slow source    |
| [The chat](../chat.md)                               | Guests, the services it needs, verification, badges, a message's details and Verify         |
| [Swarm ID](../swarm-id.md)                           | Signing in, the wallet link and ENS names, how the page talks to the Swarm ID site          |
| [Who pays for a message](../own-stamp.md)            | Gateway pays or My stamp, which source sends, the push deadline, the own-feed copy and Sync |
| [My Swarm](../my-swarm.md)                           | The panel, Use for, adding a source, the checks, settings, failure bars, browser storage    |
| [The node in this browser](../weeb3.md)              | weeb-3: loading, readiness, lost peers, its player, its reads, pictures, the live proof     |
| [The Swarm client](../swarm-client.md)               | Providers, kinds, source types, answers, the client, routing, Bee over HTTP, the contract   |
| [Extending the providers](../extending-providers.md) | Adding a new kind of source to My Swarm, with the checklist of every file it touches        |
| [The design](../design.md)                           | The two themes, tokens, variables, fonts, shared components                                 |
| [The image](../image.md)                             | The Docker image, its settings, the content security policy, caching, the release tag       |

The repository's own rules are in [AGENTS.md](../../AGENTS.md) at the root, and the landing page is the root
[README](../../README.md).
