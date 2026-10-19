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
