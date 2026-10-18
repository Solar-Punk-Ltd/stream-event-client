import type { Topic } from '@ethersphere/bee-js';

import { GatewayClock } from '@/shared/gatewayClock';

import { type AnswerKind, serverTimeOf, type SwarmAnswer, UNSUPPORTED } from './answers';
import { answerOfUrlLoad, FeatureFailureLog, type FeatureFailure, type UrlLoadOutcome } from './featureFailures';
import {
  DEFAULT_READ_TIMEOUT_MS,
  type OwnPlayer,
  type ProbeResult,
  type ProviderStatus,
  type ReadOptions,
  type SwarmProvider,
  type UrlUse,
} from './provider';

export { loadUrl, type UrlLoadOptions } from './urlLoad';
export { FAILING_AFTER_MS } from './featureFailures';
export type { FailureCause, FeatureFailure, UrlLoadOutcome } from './featureFailures';

/** The parts of the app that read Swarm, each of which the client may send to a provider of its own. */
export const SWARM_FEATURES = ['player', 'stream-list', 'previews', 'chat'] as const;

export type SwarmFeature = (typeof SWARM_FEATURES)[number];

/**
 * The features whose answers keep the gateway clock. The player's time markers sit at addresses
 * computed from that clock, so it is taken from the hosts the player and the stream list read. The
 * chat reads from the event's chat host, which may run on another clock entirely.
 */
const CLOCK_FEATURES: ReadonlySet<SwarmFeature> = new Set<SwarmFeature>(['player', 'stream-list']);

type ReadKind = 'feed-head' | 'feed-entry' | 'soc' | 'unsigned-soc' | 'chunk' | 'bytes';

/** A provider with the name the counts give it, such as a gateway's id in the settings. */
export interface NamedProvider {
  readonly id: string;
  readonly provider: SwarmProvider;
}

export interface SwarmClientOptions {
  /** The provider every feature reads from unless {@link routes} names another. */
  readonly chosen: NamedProvider;
  /** A provider of its own for a feature. */
  readonly routes?: Partial<Record<SwarmFeature, NamedProvider>>;
  /** Where the gateway's clock is kept. A fresh one when absent. */
  readonly clock?: GatewayClock;
  /** Injected by tests. The viewer's clock otherwise. */
  readonly now?: () => number;
}

/** What one feature reads Swarm through. */
export interface SwarmReader {
  readFeedHead(owner: string, topic: Topic, options?: ReadOptions): Promise<SwarmAnswer>;
  readFeedEntry(owner: string, topic: Topic, index: number, options?: ReadOptions): Promise<SwarmAnswer>;
  readSoc(owner: string, identifier: string, options?: ReadOptions): Promise<SwarmAnswer>;
  /** Present only where the feature's provider serves a single-owner chunk without its signature, see {@link SwarmProvider.readUnsignedSoc}. */
  readUnsignedSoc?(owner: string, identifier: string, options?: ReadOptions): Promise<SwarmAnswer>;
  readChunk(address: string, options?: ReadOptions): Promise<SwarmAnswer>;
  readBytes(reference: string, options?: ReadOptions): Promise<SwarmAnswer>;
  /** A URL from the feature's provider, or null when it gives none. */
  urlFor(reference: string, use: UrlUse): string | null;
  /** How the browser's or hls.js's load of one of those URLs ended, which counts toward whether the feature fails. */
  reportUrlLoad(outcome: UrlLoadOutcome): void;
}

interface ReadCount {
  readonly feature: SwarmFeature;
  readonly read: ReadKind;
  readonly provider: string;
  readonly answer: AnswerKind;
  readonly count: number;
}

/** How long the client remembers each read for {@link SwarmClient.activity}. */
const ACTIVITY_WINDOW_MS = 60_000;

interface ProviderAnswerCount {
  readonly provider: string;
  readonly answer: AnswerKind;
  readonly count: number;
}

/** What one feature read in the last {@link ACTIVITY_WINDOW_MS}, and from whom. */
export interface FeatureActivity {
  readonly feature: SwarmFeature;
  /** The provider the feature reads from. */
  readonly primary: string;
  /** Every answer in the window, by the provider that gave it and its kind, in the order first seen. */
  readonly answers: readonly ProviderAnswerCount[];
}

interface RecentAnswer {
  readonly atMs: number;
  readonly feature: SwarmFeature;
  readonly provider: string;
  readonly answer: AnswerKind;
}

/** A source's own player as the client hands it out: the same object for as long as the client lives. */
interface OwnPlayerHandle {
  readonly id: string;
  readonly load: () => Promise<OwnPlayer>;
  readonly status: () => ProviderStatus;
}

type Ask = (provider: SwarmProvider, options: ReadOptions) => Promise<SwarmAnswer>;

/**
 * The one way the app reads Swarm. Each feature reads from its own provider and from nothing else: a
 * read that fails is answered as it failed, and only the viewer picks another source. It counts every
 * read, says which features keep failing, and keeps the gateway's clock from the server time of the
 * player's and the stream list's answers.
 */
export class SwarmClient {
  private readonly chosen: NamedProvider;
  private readonly routes: Partial<Record<SwarmFeature, NamedProvider>>;
  private readonly clock: GatewayClock;
  private readonly now: () => number;
  private readonly ownPlayers = new WeakMap<SwarmProvider, OwnPlayerHandle>();
  private readonly countByKey = new Map<string, ReadCount>();
  /** Oldest first, never older than {@link ACTIVITY_WINDOW_MS}. */
  private readonly recent: RecentAnswer[] = [];
  private readonly failureLog = new FeatureFailureLog();

  constructor(options: SwarmClientOptions) {
    this.chosen = options.chosen;
    this.routes = options.routes ?? {};
    this.clock = options.clock ?? new GatewayClock();
    this.now = options.now ?? (() => Date.now());
  }

  reader(feature: SwarmFeature): SwarmReader {
    const { provider } = this.primaryFor(feature);
    return {
      ...(provider.readUnsignedSoc && {
        readUnsignedSoc: (owner: string, identifier: string, options?: ReadOptions) =>
          this.read(feature, 'unsigned-soc', options, (asked, windowed) =>
            asked.readUnsignedSoc ? asked.readUnsignedSoc(owner, identifier, windowed) : Promise.resolve(UNSUPPORTED),
          ),
      }),
      readFeedHead: (owner, topic, options) =>
        this.read(feature, 'feed-head', options, (provider, windowed) => provider.readFeedHead(owner, topic, windowed)),
      readFeedEntry: (owner, topic, index, options) =>
        this.read(feature, 'feed-entry', options, (provider, windowed) =>
          provider.readFeedEntry(owner, topic, index, windowed),
        ),
      readSoc: (owner, identifier, options) =>
        this.read(feature, 'soc', options, (provider, windowed) => provider.readSoc(owner, identifier, windowed)),
      readChunk: (address, options) =>
        this.read(feature, 'chunk', options, (provider, windowed) => provider.readChunk(address, windowed)),
      readBytes: (reference, options) =>
        this.read(feature, 'bytes', options, (provider, windowed) => provider.readBytes(reference, windowed)),
      urlFor: (reference, use) => this.primaryFor(feature).provider.urlFor(reference, use),
      reportUrlLoad: (outcome) => {
        const nowMs = this.now();
        this.failureLog.note(feature, this.primaryFor(feature).id, nowMs, answerOfUrlLoad(outcome), nowMs, 'urls');
      },
    };
  }

  counts(): ReadCount[] {
    return [...this.countByKey.values()];
  }

  /** What each feature read in the last minute, for the diagnostics a viewer copies. */
  activity(): FeatureActivity[] {
    this.forgetOldAnswers();
    return SWARM_FEATURES.map((feature) => {
      const byKey = new Map<string, ProviderAnswerCount>();
      for (const recent of this.recent) {
        if (recent.feature !== feature) {
          continue;
        }
        const key = `${recent.provider}|${recent.answer}`;
        const counted = byKey.get(key);
        byKey.set(key, { provider: recent.provider, answer: recent.answer, count: (counted?.count ?? 0) + 1 });
      }
      return { feature, primary: this.primaryFor(feature).id, answers: [...byKey.values()] };
    });
  }

  /** The features whose reads have kept failing on their source, for the page to say so. */
  failures(): FeatureFailure[] {
    return this.failureLog.failures(this.now());
  }

  /** What to add to the viewer's clock to read the gateway's. */
  clockOffsetMs(): number {
    return this.clock.offsetMs();
  }

  /**
   * The player a feature's own provider plays video with, with that provider's id, or null where the
   * app's player reads through it. Loading it starts whatever the player needs.
   */
  ownPlayer(feature: SwarmFeature): OwnPlayerHandle | null {
    const { id, provider } = this.primaryFor(feature);
    if (!provider.ownPlayer) {
      return null;
    }
    const known = this.ownPlayers.get(provider);
    if (known) {
      return known;
    }
    const handle: OwnPlayerHandle = {
      id,
      load: provider.ownPlayer,
      status: () => provider.status(),
    };
    this.ownPlayers.set(provider, handle);
    return handle;
  }

  /** Where the provider every feature reads from first is in its own life. */
  status(): ProviderStatus {
    return this.chosen.provider.status();
  }

  /** Where the provider a feature reads from is in its own life. */
  statusOf(feature: SwarmFeature): ProviderStatus {
    return this.primaryFor(feature).provider.status();
  }

  /** Asks the provider every feature reads from first whether it is there at all. Never rejects. */
  probe(options?: ReadOptions): Promise<ProbeResult> {
    return this.chosen.provider.probe(options);
  }

  async start(): Promise<void> {
    await Promise.all(this.providers().map(({ provider }) => provider.start()));
  }

  async stop(): Promise<void> {
    await Promise.all(this.providers().map(({ provider }) => provider.stop()));
  }

  /** Starts a node in the tab that failed or was lost again, on the viewer's asking. Nothing for any other provider. */
  restart(): void {
    for (const { provider } of this.providers()) {
      provider.restart?.();
    }
  }

  /** A provider that names a shortest window of its own gets at least that, whatever the caller asked. */
  private async read(
    feature: SwarmFeature,
    read: ReadKind,
    options: ReadOptions | undefined,
    ask: Ask,
  ): Promise<SwarmAnswer> {
    const { id, provider } = this.primaryFor(feature);
    const timeoutMs = Math.max(options?.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS, provider.shortestReadWindowMs ?? 0);
    const startedAtMs = this.now();
    const answer = await ask(provider, { ...options, timeoutMs });
    this.count(feature, read, id, answer.kind);
    this.failureLog.note(feature, id, startedAtMs, answer, this.now());
    const serverTimeMs = serverTimeOf(answer);
    if (serverTimeMs !== null && CLOCK_FEATURES.has(feature)) {
      this.clock.noteServerTime(serverTimeMs);
    }
    return answer;
  }

  private primaryFor(feature: SwarmFeature): NamedProvider {
    return this.routes[feature] ?? this.chosen;
  }

  private providers(): NamedProvider[] {
    const byId = new Map<string, NamedProvider>();
    for (const named of [this.chosen, ...Object.values(this.routes)]) {
      if (named && !byId.has(named.id)) {
        byId.set(named.id, named);
      }
    }
    return [...byId.values()];
  }

  private count(feature: SwarmFeature, read: ReadKind, provider: string, answer: AnswerKind): void {
    const key = `${feature}|${read}|${provider}|${answer}`;
    const current = this.countByKey.get(key);
    this.countByKey.set(key, { feature, read, provider, answer, count: (current?.count ?? 0) + 1 });
    this.recent.push({ atMs: this.now(), feature, provider, answer });
    this.forgetOldAnswers();
  }

  private forgetOldAnswers(): void {
    const oldestKeptMs = this.now() - ACTIVITY_WINDOW_MS;
    let old = 0;
    while (old < this.recent.length && this.recent[old].atMs < oldestKeptMs) {
      old += 1;
    }
    this.recent.splice(0, old);
  }
}
