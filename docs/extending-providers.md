# Extending the providers

How to add a new kind of source to My Swarm: a new way for the page to reach Swarm, beside a Bee node over HTTP and
the node in the browser. A developer who wants the viewer to read through something else starts here. Read
[the Swarm client](swarm-client.md) first for the shape of the layer.

## Two words that are not the same

- **A provider kind** is the code that reads Swarm, named in `src/swarm/providerKinds.ts`: `bee-http` and `weeb-3`.
  Each has a class implementing `SwarmProvider` and an entry in `PROVIDER_REGISTRY` (`src/swarm/registry.ts`) that
  makes one from a `GatewaySetting`. `GATEWAY_KINDS` is the subset a deployment may offer in `config.json`.
- **A source type** is what a viewer sees and adds in My Swarm, named in `src/swarm/sources.ts`: `gateway`, `bee-node`
  and `weeb-3`. `SOURCE_TYPE_KIND` maps each to the kind it is read through, so `gateway` and `bee-node` are both
  `bee-http`. A type decides the words on the tile, which checks run, whether there is an address field, and which
  type-specific branches the panel takes. A kind decides how bytes are read.

A new way of reaching Swarm may therefore be one of three things: a new kind behind an existing type (a different
protocol for a gateway address), a new type over an existing kind (a different way of presenting `bee-http`), or
both. The checklist below marks what each needs.

## The provider interface

Verbatim from `src/swarm/provider.ts`:

```ts
import type { Topic } from '@ethersphere/bee-js';

import type { SwarmAnswer } from './answers';

/**
 * How long a read may take, headers and body together, when its caller names no window. The app's
 * own bounded fetch uses the same ten seconds.
 */
export const DEFAULT_READ_TIMEOUT_MS = 10_000;

/**
 * How long a probe waits for a node before calling it timed out: long enough for a cold local node,
 * short enough that a wrong port does not feel like a hang. Connect and every provider's
 * own default use this one window.
 */
export const PROBE_TIMEOUT_MS = 5_000;

/** What every read takes. */
export interface ReadOptions {
  /** The caller's own cancellation, for example a React effect's unmount. Ends the read as aborted. */
  readonly signal?: AbortSignal;
  /** The read's window in milliseconds. {@link DEFAULT_READ_TIMEOUT_MS} when absent. */
  readonly timeoutMs?: number;
}

/**
 * What the browser or hls.js loads by URL rather than through a read: a segment written into a
 * playlist, a segment of a stream card's preview, and a stream card's picture.
 */
export type UrlUse = 'segment' | 'preview-segment' | 'thumbnail';

/**
 * Where a provider is in its own life. A provider over HTTP is always ready. `lost` is a node in the tab that was ready
 * and has since had no peers, which only starting it again on the viewer's asking mends.
 */
export type ProviderState = 'stopped' | 'starting' | 'ready' | 'failed' | 'lost';

/** How much of a download has arrived, and how much the server said there is, when it said. */
export interface DownloadProgress {
  readonly receivedBytes: number;
  readonly totalBytes: number | null;
}

export interface ProviderStatus {
  readonly state: ProviderState;
  /** What a node in the tab is downloading before it can start, while it does. */
  readonly download?: DownloadProgress;
  /** How many peers a node in the tab is connected to. Absent for a provider that reaches a node elsewhere. */
  readonly peers?: number;
  /** How many peers such a node builds up to when it is healthy, which its count is shown against. */
  readonly healthyPeers?: number;
}

/** Where a player starts a stream: at its newest entry, or at the first it can rebuild. */
export type PlaybackStart = 'live' | 'beginning';

/** One quality of a stream an own player plays, by the level the player knows it as. */
export interface PlayerLevel {
  readonly level: number;
  readonly height: number;
  readonly bitrate: number;
}

/** The qualities of the stream an own player plays, the one asked for and the one playing, -1 for none. */
export interface PlayerQuality {
  readonly levels: readonly PlayerLevel[];
  readonly selectedLevel: number;
  readonly currentLevel: number;
}

/** A player a provider brings with it, which plays a stream into a video element the page owns. */
export interface OwnPlayer {
  attach(video: HTMLVideoElement, owner: string, topic: string, from: PlaybackStart): Promise<void>;
  /** The attached stream's qualities, or null before they have loaded. Absent for a player that offers no choice. */
  readonly quality?: () => PlayerQuality | null;
  /** Switches the attached stream to one level. Throws while the player cannot switch, as during a seek. */
  readonly holdQuality?: (level: number) => void;
  /**
   * Stops the player loading for the video it attached, and lets go of what it held, such as a node in the tab, which
   * stops once nothing holds it.
   */
  detach(): void;
}

/** Why a node that answered cannot serve reads yet. */
export type NotReadyReason =
  | { readonly kind: 'starting' }
  /** Connected to nobody, so nothing it is asked for can be fetched from the network. */
  | { readonly kind: 'no-peers' }
  /** Older than the oldest release whose API this viewer reads. */
  | { readonly kind: 'too-old'; readonly version: string; readonly needed: string };

/** What asking a provider whether it is there at all found. */
export type ProbeResult =
  /** `version` is the Bee release the node states, absent where it states none. */
  | { readonly kind: 'ok'; readonly elapsedMs: number; readonly version?: string }
  /** Something answered, but not as a Swarm node does. */
  | { readonly kind: 'not-swarm' }
  /** A Swarm node answered and cannot serve reads yet. */
  | { readonly kind: 'not-ready'; readonly reason: NotReadyReason }
  | { readonly kind: 'rejected'; readonly status: number }
  | { readonly kind: 'timed-out' }
  /** Something answered, and the browser would not let this page read the answer, which is a CORS refusal. */
  | { readonly kind: 'refuses-this-site' }
  | { readonly kind: 'unreachable' };

/**
 * One way of reaching Swarm, holding only what this app reads.
 *
 * Every read resolves to a {@link SwarmAnswer} and never rejects. Owners are Ethereum addresses as
 * hex, references and chunk addresses are 32 bytes as hex, both as the stream list and the chat
 * carry them.
 */
export interface SwarmProvider {
  /** The newest entry of a feed, as the node's own lookup finds it. Slow on a feed that moves. */
  readFeedHead(owner: string, topic: Topic, options?: ReadOptions): Promise<SwarmAnswer>;

  /** One entry of a feed by its index, which is how a follower reads once it knows where it is. */
  readFeedEntry(owner: string, topic: Topic, index: number, options?: ReadOptions): Promise<SwarmAnswer>;

  /**
   * The payload of the single-owner chunk an owner wrote under an identifier, which is how the player
   * reads a ladder's time markers. The identifier is 32 bytes as hex.
   */
  readSoc(owner: string, identifier: string, options?: ReadOptions): Promise<SwarmAnswer>;

  /**
   * The chunk an owner's single-owner chunk wraps, its 8-byte little-endian span then its payload, for a provider that
   * serves a single-owner chunk without the identifier and signature that prove it the owner's, as the node in this
   * browser does. Its answer is that provider's word for whose chunk it is. Absent where {@link readChunk} serves the
   * whole single-owner chunk, which the reader then checks itself.
   */
  readUnsignedSoc?(owner: string, identifier: string, options?: ReadOptions): Promise<SwarmAnswer>;

  /** One chunk by its address, which is how the chat reads its slots and notes. */
  readChunk(address: string, options?: ReadOptions): Promise<SwarmAnswer>;

  /** The bytes a reference names, joined from its chunks. */
  readBytes(reference: string, options?: ReadOptions): Promise<SwarmAnswer>;

  /** A URL the browser or hls.js can load for a reference itself, or null when this provider gives none. */
  urlFor(reference: string, use: UrlUse): string | null;

  status(): ProviderStatus;

  /** Never rejects: every way of not being there is a result. */
  probe(options?: ReadOptions): Promise<ProbeResult>;

  /**
   * The player this provider plays video with, for a provider that brings its own rather than serving
   * the app's player. Absent where the app's player reads through the provider.
   */
  readonly ownPlayer?: () => Promise<OwnPlayer>;

  /**
   * The shortest window a read through this provider is given, for a provider whose reads take longer
   * than a caller's usual window. Absent where the caller's window stands.
   */
  readonly shortestReadWindowMs?: number;

  /** Starts a node in the tab. Resolves at once for a provider that reaches a node elsewhere. */
  start(): Promise<void>;

  /**
   * Starts a node in the tab that failed or was lost again, keeping whatever holds it, on the viewer's asking. Absent
   * for a provider that reaches a node elsewhere.
   */
  readonly restart?: () => void;

  stop(): Promise<void>;
}
```

The answers a read resolves to are in `src/swarm/answers.ts`: `content` with the bytes, the feed index and the server
time where known, `not-found`, `rate-limited` with the wait asked for, `unsupported`, `unavailable` with its cause
(timeout, status or network), and `aborted`. A provider never throws for a read.

## A minimal provider

The smallest real provider is `BeeHttpProvider` (`src/swarm/providers/bee-http/beeHttpProvider.ts`), and the smallest
of all is the test double `ScriptedProvider` in `test/helpers/scriptedProvider.ts`. A new kind that reaches a node at
an address follows the Bee one's shape:

```ts
// src/swarm/providers/my-kind/myKindProvider.ts
import type { Topic } from '@ethersphere/bee-js';

import { UNSUPPORTED, type SwarmAnswer } from '../../answers';
import type { ProbeResult, ProviderStatus, ReadOptions, SwarmProvider, UrlUse } from '../../provider';
import { httpRead } from '../../httpRead';

export interface MyKindProviderOptions {
  readonly baseUrl: string;
  /** Injected by tests. The global `fetch` otherwise. */
  readonly fetcher?: typeof fetch;
}

export class MyKindProvider implements SwarmProvider {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(options: MyKindProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetcher = options.fetcher ?? fetch;
  }

  readFeedHead(owner: string, topic: Topic, options?: ReadOptions): Promise<SwarmAnswer> {
    return this.read(`feeds/${owner}/${topic.toString()}`, options);
  }

  async readFeedEntry(owner: string, topic: Topic, index: number, options?: ReadOptions): Promise<SwarmAnswer> {
    if (!Number.isSafeInteger(index) || index < 0) {
      return UNSUPPORTED;
    }
    // Derive the entry's single-owner chunk identifier from the topic and the index, as the Bee provider does with
    // makeFeedIdentifier from src/shared/feedFollow.ts, and read it with readSoc.
    return this.readSoc(owner, identifierOf(topic, index), options);
  }

  readSoc(owner: string, identifier: string, options?: ReadOptions): Promise<SwarmAnswer> {
    return this.read(`soc/${owner}/${identifier}`, options);
  }

  readChunk(address: string, options?: ReadOptions): Promise<SwarmAnswer> {
    return this.read(`chunks/${address}`, options);
  }

  readBytes(reference: string, options?: ReadOptions): Promise<SwarmAnswer> {
    return this.read(`bytes/${reference}`, options);
  }

  urlFor(reference: string, use: UrlUse): string | null {
    return use === 'thumbnail' ? `${this.baseUrl}/bzz/${reference}/` : `${this.baseUrl}/bytes/${reference}`;
  }

  status(): ProviderStatus {
    return { state: 'ready' };
  }

  async probe(options: ReadOptions = {}): Promise<ProbeResult> {
    // Ask the node whether it is there, and map every way of not being there to a ProbeResult. Never throw.
    ...
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  private read(path: string, options?: ReadOptions): Promise<SwarmAnswer> {
    return httpRead(`${this.baseUrl}/${path}`, { ...options, fetcher: this.fetcher });
  }
}
```

`httpRead` (`src/swarm/httpRead.ts`) and `boundedRequest` (`src/swarm/boundedRequest.ts`) turn a response into a
`SwarmAnswer` under the read's window, with Bee's statuses mapped as [the Swarm client](swarm-client.md) describes. Read
the Bee provider for the real `probe` and for how it joins a body longer than one chunk.

A provider that runs a node in the tab follows `Weeb3Provider` instead: a `status()` that moves through `stopped`,
`starting`, `ready`, `failed` and `lost`, a `start()` that resolves when the node is ready, `restart`, and a
`shortestReadWindowMs` where its reads need one. A provider that brings its own video player adds `ownPlayer`, and its
`OwnPlayer` may offer `quality` and `holdQuality` for the page's Quality picker.

Then register the kind:

```ts
// src/swarm/providerKinds.ts
export const GATEWAY_KINDS = ['bee-http', 'my-kind'] as const; // only if a deployment may offer it in config.json
export const PROVIDER_KINDS = [...GATEWAY_KINDS, 'weeb-3'] as const;

// src/swarm/registry.ts
'my-kind': {
  label: 'A node over my protocol',
  create: (gateway, environment) => new MyKindProvider({ baseUrl: gateway.url, ...environment }),
},
```

`PROVIDER_REGISTRY` is a `Record<ProviderKindName, ProviderKind>`, so a kind missing from it fails the typecheck, and
`test/swarm/settings.test.ts` asserts the registry's keys equal `PROVIDER_KINDS` with a non-empty label each.

## The checklist: every file a new kind or type touches

"Compile-enforced" means a `Record` keyed by the union or an exhaustive `switch` turns a missing case into a type
error. "Hand-listed" means a literal list a new entry has to be added to by hand, which no check catches.

### The Swarm layer (a new kind)

1. `src/swarm/providerKinds.ts`: add the name to `GATEWAY_KINDS` if a deployment may offer it in `config.json`, else to
   the `PROVIDER_KINDS` spread. `ProviderKindName` follows.
2. `src/swarm/providers/<kind>/`: the class implementing `SwarmProvider`.
3. `src/swarm/registry.ts`: the `PROVIDER_REGISTRY` entry. Compile-enforced.
4. `src/config/runtimeConfig.ts`, only if a deployment may offer it: a schema with `kind: z.literal('<kind>')` in the
   `gatewaySchema` discriminated union. `test/runtimeConfig.test.ts` has the tests that refuse a kind a deployment may
   not offer, which `weeb-3` shows.

### The sources (a new type)

5. `src/swarm/sources.ts`: `SOURCE_TYPES` (hand-listed), `SOURCE_TYPE_KIND` and `DEFAULT_NAMES` (compile-enforced),
   and `hasAddress`, which is hard-coded as `type !== 'weeb-3'`. `parseAddedSources` keeps a saved entry only when
   its type is listed and its address is present exactly when `hasAddress` says so.

### My Swarm, the panel (`src/features/connect/`)

6. `connectWords.ts`: `KIND_LABELS`, `ADD_TILES` and `ADD_VIEWS` are `Record<SourceType, ...>`, compile-enforced.
   `ADDRESS_PLACEHOLDERS` is keyed by `'gateway' | 'bee-node'` only, so a type with an address extends that key.
7. `AddSourceViews.tsx`: the tile list is the hand-listed literal `['gateway', 'bee-node', 'weeb-3']`, and `ONE_EACH`
   names the types a browser holds one of. `AddAddressView` takes `type: 'gateway' | 'bee-node'`, with a local
   `DEFAULT_NAMES` and `addressToCheck`. `AddWeeb3View` is weeb-3 only. A type with an address widens the address view,
   a type without one gets a view of its own.
8. `Connect.tsx`: `shown.type === 'weeb-3' ? <AddWeeb3View /> : <AddAddressView />` picks the add view, and
   `isAddingWeeb3` asks before closing. A new type without an address joins both branches.
9. `SwarmAccess.tsx` (the `hasAddress` branch, `NodeInTabMeta` for a node in the tab) and `SourceSettings.tsx` (the
   `hasAddress` branches, node start and stop on test, the `WEEB3_VERSION` and `WEEB3_NETWORK` lines).
10. `ChatStampSection.tsx`: `SENDS_THROUGH` is keyed by the own-stamp route's `through`, `'bee-node'` and `'weeb-3'`,
    hand-listed. Only if the new type can send a message on the viewer's own stamp.

### The checks (`src/features/gateway/`)

11. `checkWords.ts`: `CheckStep` (the union of every check), `CHECK_STEPS` (`Record<SourceType, ...>`,
    compile-enforced), `LINES` (`Record<CheckStep, string>`), `checkLine`, and `corsRefused`, which branches on
    `type === 'bee-node'`. `test/gateway/checkWords.test.ts` asserts each type's lines.
12. `sourceChecks.ts`: `CheckRun.step` switches over `CheckStep` exhaustively, so a new step needs a case.
    `addressRefusal` branches on `'bee-node'`, `version` on `'gateway'`, `readStreamListAnswer` and `readsStreamList`
    on `'weeb-3'`, and `nodeStarted` and `nodeHasPeers` are for a node in the tab.
13. `sourceStatus.ts`: `checkSourceStatus` branches on `'weeb-3'`, then `'bee-node'`, and treats anything else as a
    gateway asked for the stream list's first entry.
14. `gatewayProbe.ts`: `checkSourceAddress` adds `https://` for `type === 'gateway'` and runs the own-node rules for a
    Bee node.
15. `NodeInTabProgress.tsx` (`type === 'weeb-3'`), `useNodeInTabStatus.ts` and `src/shared/nodeInTabStatus.ts` are
    weeb-3-named, and `src/features/player/OwnPlayerStage.tsx` and `placeAcrossSwap.ts` read them. Only for a kind that
    runs a node in the tab or brings its own player.

### The chat on the viewer's own stamp (`src/features/chat/stamp/`)

16. `ownStampRoute.ts`: the `OwnStampRoute` union and the exhaustive `switch (source.type)`, plus the fallback that
    looks for a `'bee-node'` then a `'weeb-3'`. `ChatStamp.tsx` branches on `route.through` for the send,
    `stampProblems.ts` reads the push's errors, `ownStampWrite.ts` names `NO_NODE`, and
    `Chat/StampWarningBar/StampWarningBar.tsx` and the `OWN_STAMP_NEEDS_*` texts in `connectWords.ts` name the types
    that can send. Only if the new kind can send a stamped chunk.

### The app

17. `src/app/AppProvider.tsx`: `hasAddress(source.type)` decides whether the chat history's address is handed to Swarm
    ID, and `swarmClientFor` is generic over `gatewaySettingOf`. Nothing kind-specific, unless the new kind has no
    address.
18. `src/swarm/client.ts`: nothing kind-specific. `SWARM_FEATURES` changes only for a new **part**, and then also
    `resolveRouting` in `routing.ts` (four keys hard-coded), `swarmClientFor`'s tuple
    `['stream-list', 'previews', 'chat']` in `AppProvider.tsx`, the part list in `UseFor.tsx`, `PART_LABELS` in
    `connectWords.ts` and `FEATURE_LABELS` in `providerStatus.ts`.

### Build, serve and policy

19. `deploy/nginx/40-gateway-and-policy.sh`: the content security policy. A kind that reaches an https address needs
    nothing, since `https:` is in `connect-src` and `img-src`. A kind that reaches a new scheme or a plain http origin
    beyond the viewer's machine, or compiles WebAssembly, or opens websockets to a host `wss:` does not cover, adds its
    source to the policy there, and `test/image.test.ts` asserts the policy. `deploy/nginx/default.conf`'s `/weeb-3/`
    location, `scripts/weeb3-files.mjs` and the `weeb3Files` plugin in `vite.config.js` are weeb-3 only: a kind that
    ships files of its own follows that shape.

### Tests

20. The provider contract: `test/swarm/providerContract.ts` exports `describeProviderContract(name, harness)`. Add a
    `test/swarm/<kind>Provider.test.ts` that builds a `ContractHarness` (a world of content the provider holds, a
    `retryAfterMs`, and a provider for each far-side behaviour: `served`, `silent`, `faulty`, `rate-limited`) and
    calls it, as `beeHttpProvider.test.ts` and `weeb3Provider.test.ts` do.
21. The boundary: `test/swarm/boundary.test.ts` needs no change for a provider that stays inside `src/swarm`. A feature
    that must import past the public surface, as the chat's writes do, adds a named entry to
    `ALLOWED_PAST_THE_SURFACE` with its reason.
22. Then run the type check and the test suite and fix what breaks. Several suites enumerate the kinds or the types,
    under `test/swarm/`, `test/gateway/`, `test/connect/` and `test/chat/`, and each names what it expects of a new
    one.
23. Doubles and browser fakes: the unit tests use `test/helpers/scriptedProvider.ts` and `test/helpers/fakeWeeb3.ts`,
    and the browser journeys use `e2e/fakeWeeb3.ts` and `e2e/fakeSwarmIdSite.ts`. A new kind the journeys should cover
    gets a fake of its own and a spec beside `e2e/connect.e2e.ts` and `e2e/weeb3.e2e.ts`.
24. The docs: [configuration](configuration.md), [My Swarm](my-swarm.md), [the Swarm client](swarm-client.md) and the
    storage table, and this page.

## How a new kind is checked on the panel

Two checks run against a source, both through a client made for that source alone
(`useCheckClient` in `src/features/connect/useSourceChecks.ts`, which calls `createSwarmClient(onlyGateway(...))`):

- **The full check**, before adding and on Test connection: `runSourceChecks` in
  `src/features/gateway/sourceChecks.ts` runs `CHECK_STEPS[type]` in order and stops at the first failure. The reads
  (`chunk`, `bytes`, `feed`) go through the provider like any other read, so a provider that answers correctly passes
  them with nothing kind-specific. The address, CORS, version and readiness steps are type-specific, and a new type
  picks the steps it needs and adds a case for any new one.
- **The light status**, every 10 s while the panel is open: `checkSourceStatus` in `sourceStatus.ts`, a `probe` for a
  Bee node, the node's own `status()` for weeb-3, and one feed entry read for a gateway. A new kind decides which of
  the three fits, or adds a branch.

The provider's own `probe()` is what both lean on for "is it there": map every way of not being there to a
`ProbeResult` and never throw.

## How a source is stored and routed

A source the viewer added is kept in `localStorage` under `swarm-sources` as `{id, type, name, url}`
(`src/app/sourceStorage.ts`, `serializeAddedSources` and `parseAddedSources` in `src/swarm/sources.ts`), its `url`
empty exactly when `hasAddress(type)` is false. An entry of an unknown type is dropped on load, so a build without the
new type ignores what a build with it saved. The offered gateways are never stored, they come from `config.json`.

Routing is kept under `swarm-routing` (`src/swarm/routing.ts`): the mode, the one source, and a source id per part.
`resolveRouting` turns it into a source id for each of `player`, `stream-list`, `previews` and `chat`, with any id no
longer known replaced by the default gateway's. `AppProvider.swarmClientFor` then makes the client with the player's
source as the choice and a route per other part (`gatewaySettingOf(source)` gives the `GatewaySetting` the registry
makes the provider from, `chatHistorySettingOf` for the chat), so a new kind is routed to a part the moment its source
is picked under Use for. Nothing in routing is kind-specific.

## The boundary test's comment

`test/swarm/boundary.test.ts` says above `PUBLIC_SURFACE` that a provider's own files and the registry stay behind the
public surface. That holds for the Swarm layer: a new kind's reads reach every part through the client without any
feature importing it. The checklist above is what a new kind or type still touches outside `src/swarm`, in the panel,
the checks and the chat's own-stamp path, because those are written per type.
