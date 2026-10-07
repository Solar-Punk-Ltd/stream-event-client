import type { Topic } from '@ethersphere/bee-js';

import type { SwarmAnswer } from './answers';

/**
 * How long a read may take, headers and body together, when its caller names no window. The same
 * ten seconds the app's own bounded fetch has always used.
 */
export const DEFAULT_READ_TIMEOUT_MS = 10_000;

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

/** Which reads a provider can make, so a client asks another one before asking in vain. */
export interface ProviderCapabilities {
  readonly feedHead: boolean;
  readonly feedEntry: boolean;
  readonly soc: boolean;
  readonly chunk: boolean;
  readonly bytes: boolean;
  /** Whether {@link SwarmProvider.urlFor} gives URLs. A provider without them is read through `readBytes`. */
  readonly urls: boolean;
  /** Whether the provider runs a node inside the tab, which {@link SwarmProvider.start} starts. */
  readonly inTab: boolean;
}

/** Where a provider is in its own life. A provider over HTTP is always ready. */
export type ProviderState = 'stopped' | 'starting' | 'ready' | 'failed';

export interface ProviderStatus {
  readonly state: ProviderState;
}

/** What asking a provider whether it is there at all found. */
export type ProbeResult =
  | { readonly kind: 'ok'; readonly elapsedMs: number }
  /** Something answered, but not as a Swarm node does. */
  | { readonly kind: 'not-swarm' }
  | { readonly kind: 'rejected'; readonly status: number }
  | { readonly kind: 'timed-out' }
  | { readonly kind: 'unreachable' };

/**
 * One way of reaching Swarm, holding only what this app reads.
 *
 * Every read resolves to a {@link SwarmAnswer} and never rejects. Owners are Ethereum addresses as
 * hex, references and chunk addresses are 32 bytes as hex, both as the stream list and the chat
 * carry them.
 */
export interface SwarmProvider {
  readonly capabilities: ProviderCapabilities;

  /** The newest entry of a feed, as the node's own lookup finds it. Slow on a feed that moves. */
  readFeedHead(owner: string, topic: Topic, options?: ReadOptions): Promise<SwarmAnswer>;

  /** One entry of a feed by its index, which is how a follower reads once it knows where it is. */
  readFeedEntry(owner: string, topic: Topic, index: number, options?: ReadOptions): Promise<SwarmAnswer>;

  /**
   * The payload of the single-owner chunk an owner wrote under an identifier, which is how the player
   * reads a ladder's time markers. The identifier is 32 bytes as hex.
   */
  readSoc(owner: string, identifier: string, options?: ReadOptions): Promise<SwarmAnswer>;

  /** One chunk by its address, which is how the chat reads its slots and notes. */
  readChunk(address: string, options?: ReadOptions): Promise<SwarmAnswer>;

  /** The bytes a reference names, joined from its chunks. */
  readBytes(reference: string, options?: ReadOptions): Promise<SwarmAnswer>;

  /** A URL the browser or hls.js can load for a reference itself, or null when this provider gives none. */
  urlFor(reference: string, use: UrlUse): string | null;

  status(): ProviderStatus;

  /** Never rejects: every way of not being there is a result. */
  probe(options?: ReadOptions): Promise<ProbeResult>;

  /** Starts a node in the tab. Resolves at once for a provider that reaches a node elsewhere. */
  start(): Promise<void>;

  stop(): Promise<void>;
}
