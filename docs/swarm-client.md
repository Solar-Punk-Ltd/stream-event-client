# The Swarm client

`src/swarm/` is the one layer that reads Swarm. Every feature, the player, the stream list, the previews and the chat,
reads through it and never reaches Swarm on its own. This page says what the layer is made of, how an answer looks,
and where each feature reads, which is what a developer needs before adding a read or a source.

The layer is plain TypeScript with no React, and it imports nothing from `src/app` or `src/features`. A test fails on a
line in the features or the app that builds a Bee URL, calls fetch, or makes a Bee client of its own, and on an import
of anything in `src/swarm` beyond the client's public surface, `client`, `answers`, `provider`, `settings`,
`createSwarmClient`, `addressSpace`, `sources` and `routing` (`test/swarm/boundary.test.ts`). Seven imports past it are
named exceptions, each with its reason in the test, all for the chat's writes, which no provider makes:

| File                                       | Imports from `src/swarm`              | For                                           |
| ------------------------------------------ | ------------------------------------- | --------------------------------------------- |
| `src/features/chat/chatParts.ts`           | `providers/bee-http/gsocWrite`        | the event chat write                          |
| `src/features/chat/chatParts.ts`           | `singleOwnerChunk`                    | how much payload one chunk carries            |
| `src/features/chat/ownersChunk.ts`         | `singleOwnerChunk`                    | checking a slot or an own copy is its owner's |
| `src/features/chat/stamp/ownStampWrite.ts` | `providers/bee-http/stampedSocUpload` | the own-stamp write to a Bee node             |
| `src/features/chat/stamp/ChatStamp.tsx`    | `providers/weeb-3/weeb3Push`          | the own-stamp push through Weeb3              |
| `src/features/chat/stamp/stampProblems.ts` | `providers/weeb-3/weeb3Push`          | what the push's error says                    |
| `src/features/chat/stamp/stampProblems.ts` | `providers/bee-http/stampedSocUpload` | what the Bee node's write error says          |

## The pieces

- **A provider** is one way of reaching Swarm (`src/swarm/provider.ts`, the interface `SwarmProvider`), holding only
  what the app reads: a feed's head, a feed entry by index, a single-owner chunk's payload by its owner and identifier
  (a feed entry is one, and so is a ladder's time marker), a chunk, the bytes a reference names, and a URL for what the
  browser or hls.js loads itself. It also has its status, a probe, and start and stop for a node in the tab.
  - Four members are optional, for a provider that needs them: `readUnsignedSoc` for one that serves a single-owner
    chunk without its signature, `ownPlayer` for one that brings its own video player, `shortestReadWindowMs` for one
    whose reads need a longer window than a caller gives, and `restart` for a node in the tab that failed or was lost.
  - An own player (`OwnPlayer`) attaches a stream to a video element the page owns and detaches it. It may also offer
    `quality`, the stream's levels with the one asked for and the one playing (`PlayerQuality`), and `holdQuality`,
    which holds the stream at one level. The Weeb3 player's Quality picker is built on those two, as
    [weeb-3](weeb3.md) says.
  - The interface is quoted in full in [extending the providers](extending-providers.md).
- **A provider kind** is the code behind a provider, named in `src/swarm/providerKinds.ts`: `bee-http`, a Bee node's
  HTTP API, and `weeb-3`, the node in the browser. `GATEWAY_KINDS` is the subset a deployment may offer in
  `config.json`, today `bee-http` alone. The registry (`src/swarm/registry.ts`) maps each kind to a label and a maker.
- **A source type** is what a viewer sees and adds in My Swarm (`src/swarm/sources.ts`): `gateway`, `bee-node` and
  `weeb-3`. Two of them, a gateway and a Bee node of the viewer's own, are both read through the `bee-http` kind. The
  gateways `config.json` offers are always sources of type `gateway`, marked offered.
- **Every read answers and never throws** (`src/swarm/answers.ts`): the content, with the feed index and the server
  time where the answer carries them, not found, rate limited with the wait asked for, unsupported, unavailable with its
  cause (a timeout, a status or no answer at all), or aborted. Every read takes a signal and a window, ten seconds when
  none is given.
  - Bee's 404 is not found, its 429 is rate limited with its `Retry-After` capped at a minute, and any other failing
    status, a 500 included, is unavailable.
  - A chunk read is the exception: Bee answers 500 for a chat slot never written, which an idle chat asks for on every
    poll, so there a 500 is not found.
- **The client** (`src/swarm/client.ts`) is made from the settings and the viewer's choice by `createSwarmClient`
  (`src/swarm/createSwarmClient.ts`), which makes each gateway's provider through the registry of kinds.
  - Each feature reads through its own provider and through nothing else. A read that fails answers as it failed, and
    the feature's own retry, such as the player's backoff, asks the same provider again.
  - URLs come from the feature's own provider, and a segment URL the player already holds is named again by the new
    source at a switch, as each segment is loaded, for a live stream as for a recording.
  - Every read is counted by feature, kind, provider and answer, and `activity()` gives the last minute's answers per
    feature, which the diagnostics carry.
  - The server time of the player's and the stream list's answers keeps the gateway clock, and the chat's, read from
    the chat's own host, does not.
  - A read's window is never shorter than the provider's `shortestReadWindowMs`.
  - Failures per feature are kept in `featureFailures.ts`: a part with no usable answer for 10 s is failing, and the
    bar under the header says so. A read counts when it ends, so a read given a longer window, such as the stream
    list's one head lookup, raises no bar while it is still running.
- **Routing** (`src/swarm/routing.ts`) says which source each part reads from, in `one` mode a single source for every
  part and in `per-part` mode one each for `player`, `stream-list`, `previews` and `chat`. `resolveRouting` replaces an
  id that is no longer known with the default gateway's.

## Where each feature reads

`AppProvider` (`src/app/AppProvider.tsx`) makes one client at start from `config.json` and the viewer's saved sources,
and makes it again when the viewer changes what a part reads from. Components get it from the app context. The player
reads through `reader('player')`, the stream list through `reader('stream-list')`, the previews and pictures through
`reader('previews')`, My Swarm checks a source through a client made for that source alone, and the chat reads through
`reader('chat')`, on the source picked for the chat history. The chat history of the deployment's default gateway is
read at `chat.readUrl` rather than the gateway's own address (`chatHistorySettingOf` in `sources.ts`).

## Bee over HTTP

`src/swarm/providers/bee-http/beeHttpProvider.ts` is Bee's HTTP API. It asks `/feeds` for a head,
`/soc/<owner>/<identifier>` for a feed entry or a marker, `/chunks/<address>`, `/bytes/<reference>` and
`/bzz/<reference>/` for a picture.

- Some public gateways refuse `/soc` at their front door, with a plain-text `Not Found` where Bee answers every 404 as
  JSON, and serve the same chunk at `/chunks/<address>`. So a 404 on `/soc` that is not Bee's JSON makes the provider
  read that single-owner chunk by its address, and every later one there first.
- It checks the chunk is the owner's, its signature recovering the owner who with the identifier makes the address
  asked, and joins a body longer than one chunk from `/bytes` at the root it wraps, as `/soc` does.
- Bee's own JSON 404 stays not found and asks nothing more, so a gateway that serves `/soc`, the event gateway among
  them, pays no extra request for a slot not written yet. When the chunk address is refused as well, the read is
  unavailable with that 404, and the next one asks `/soc` again.
- Its probe asks `/health`, `/readiness` and `/peers`, and tells a CORS refusal from nothing there by a second request
  the browser cannot read.

The node in the browser is described in [weeb-3](weeb3.md).

## The contract

`test/swarm/providerContract.ts` is the suite every provider kind must pass. It is run for Bee over HTTP
(`test/swarm/beeHttpProvider.test.ts`) against the answers the browser smoke test replays, and for weeb-3
(`test/swarm/weeb3Provider.test.ts`) against a scripted view of the node in the tab. A harness hands it a world of
content the provider holds and a provider for each behaviour of the far side: served, silent, faulty and rate limited.
