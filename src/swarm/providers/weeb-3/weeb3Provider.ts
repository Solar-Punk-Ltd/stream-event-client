import { ChunkBuilder, FeedIndex, Identifier, Span, type Topic } from '@ethersphere/bee-js';

import { makeFeedIdentifier } from '@/shared/feedFollow';
import { ABORTED, type SwarmAnswer, UNSUPPORTED } from '../../answers';
import { httpRead } from '../../httpRead';
import type { OwnPlayer, ProbeResult, ProviderStatus, ReadOptions, SwarmProvider, UrlUse } from '../../provider';
import { MAX_CHUNK_PAYLOAD, singleOwnerChunkAddress } from '../../singleOwnerChunk';
import { findNewestEntry } from './newestEntrySearch';
import type { Weeb3Node } from './weeb3Package';
import { WEEB3_HEALTHY_PEERS, WEEB3_LOST_PEERS, WEEB3_PATH, type Weeb3Runtime } from './weeb3Runtime';

const SPAN_LENGTH = 8;

/** weeb-3's own budget for a whole read, so its 17 s give-up on a missing chunk ends as not found, not a timeout. */
const WEEB3_READ_WINDOW_MS = 30_000;

/** What the provider needs of the page's node: where it is, and a way to start and stop it. */
export type Weeb3RuntimeView = Pick<Weeb3Runtime, 'status' | 'acquire' | 'release' | 'whenReady' | 'restart'>;

interface Weeb3ProviderOptions {
  readonly runtime: Weeb3RuntimeView;
  /** Injected by tests. The global `fetch` otherwise. */
  readonly fetcher?: typeof fetch;
  /** The page's own origin, which weeb-3's routes are on. Read from the page when absent. */
  readonly pageOrigin?: string;
}

function currentPageOrigin(): string {
  return typeof location === 'undefined' ? 'http://localhost' : location.origin;
}

const notReady = (why: string): SwarmAnswer => ({
  kind: 'unavailable',
  cause: { kind: 'network', error: new Error(`the node in this browser ${why}`) },
});

/** Settles with the promise, or with null once the signal stops waiting for it. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T | null> {
  if (!signal) {
    return promise;
  }
  return new Promise((resolve, reject) => {
    const stop = () => resolve(null);
    signal.addEventListener('abort', stop, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', stop);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', stop);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** A content answer with weeb-3's span taken off the front, which Bee's own reads do not carry. */
function withoutSpan(answer: SwarmAnswer): SwarmAnswer {
  if (answer.kind !== 'content') {
    return answer;
  }
  if (answer.bytes.length < SPAN_LENGTH) {
    return notReady('answering fewer bytes than a span');
  }
  return { ...answer, bytes: answer.bytes.slice(SPAN_LENGTH) };
}

/** Whether a chunk's span and payload make the content address it was read at. */
function isContentAddressedAt(bytes: Uint8Array, address: string): boolean {
  if (bytes.length < SPAN_LENGTH || bytes.length - SPAN_LENGTH > MAX_CHUNK_PAYLOAD) {
    return false;
  }
  const chunk = new ChunkBuilder(Span.fromSlice(bytes, 0).toBigInt());
  chunk.writer.buffer.set(bytes.slice(SPAN_LENGTH));
  return chunk.hash().toHex() === address.toLowerCase();
}

/** weeb-3's level that lets its player choose the quality itself. */
const AUTO_QUALITY = -1;

/**
 * Lets weeb-3's player choose its quality, now if the stream's qualities have loaded, and otherwise once the video
 * knows its first quality, by which time they have.
 */
function chooseQualityItself(node: Weeb3Node, video: HTMLMediaElement): void {
  try {
    node.setStreamQuality(video, AUTO_QUALITY);
  } catch {
    video.addEventListener(
      'loadedmetadata',
      () => {
        try {
          node.setStreamQuality(video, AUTO_QUALITY);
        } catch (error) {
          console.warn("weeb-3's player stays on its highest quality, it would not choose its own:", error);
        }
      },
      { once: true },
    );
  }
}

/**
 * Swarm read through the node running in this browser, weeb-3, over the routes its service worker
 * answers on this page. A missing chunk is a 404 there, after weeb-3 has asked the network for about
 * 17 s, so every read is given weeb-3's own budget rather than the client's shorter default. A read
 * holds the node while it runs, starting it when nothing held it, and waits for it to be ready rather
 * than answering early, so a part reading from a node that is still starting waits for it.
 *
 * Every chunk and bytes answer starts with the span, which Bee's `/soc` and `/bytes` leave out, so it
 * is taken off. A single-owner chunk comes back as its span and payload without the identifier and
 * signature that prove it its owner's, so it is read as the payload of `/soc` is, and a whole chunk is
 * served only where it is content-addressed and its address can be checked here.
 */
export class Weeb3Provider implements SwarmProvider {
  readonly shortestReadWindowMs = WEEB3_READ_WINDOW_MS;

  private readonly runtime: Weeb3RuntimeView;
  private readonly fetcher: typeof fetch;
  private readonly pageOrigin: string;
  /** The newest entry found of each feed, by owner and topic, which the next head read starts from. */
  private readonly headsFound = new Map<string, number>();

  constructor(options: Weeb3ProviderOptions) {
    this.runtime = options.runtime;
    // Handed on as a value and called bare by `boundedRequest`, never as this object's method, which the
    // browser's fetch would refuse as an illegal invocation.
    this.fetcher = options.fetcher ?? fetch;
    this.pageOrigin = options.pageOrigin ?? currentPageOrigin();
  }

  /**
   * weeb-3's feed route is its own player's playlist and reports no index, so the newest entry is found by reading
   * entries by index. A miss costs weeb-3 about 17 s, so a first head read takes a few of those, and every later one
   * starts from the head found before, which costs a polled feed one round.
   */
  async readFeedHead(owner: string, topic: Topic, options?: ReadOptions): Promise<SwarmAnswer> {
    if (options?.signal?.aborted) {
      return ABORTED;
    }
    const feed = `${owner.toLowerCase()}/${topic.toHex()}`;
    const answer = await findNewestEntry(
      (index) => this.readFeedEntry(owner, topic, index, options),
      this.headsFound.get(feed),
    );
    if (answer.kind === 'content' && answer.feedIndex !== null) {
      this.headsFound.set(feed, answer.feedIndex);
    } else if (answer.kind === 'not-found') {
      this.headsFound.delete(feed);
    }
    return answer;
  }

  async readFeedEntry(owner: string, topic: Topic, index: number, options?: ReadOptions): Promise<SwarmAnswer> {
    if (!Number.isSafeInteger(index) || index < 0) {
      return UNSUPPORTED;
    }
    return this.readSocAt(makeFeedIdentifier(topic, FeedIndex.fromBigInt(BigInt(index))), owner, options);
  }

  async readSoc(owner: string, identifier: string, options?: ReadOptions): Promise<SwarmAnswer> {
    let id: Identifier;
    try {
      id = new Identifier(identifier);
    } catch {
      return UNSUPPORTED;
    }
    return this.readSocAt(id, owner, options);
  }

  /** weeb-3 serves a single-owner chunk as the chunk it wraps, span and payload, with no signature to check. */
  async readUnsignedSoc(owner: string, identifier: string, options?: ReadOptions): Promise<SwarmAnswer> {
    let address: string;
    try {
      address = singleOwnerChunkAddress(new Identifier(identifier), owner);
    } catch {
      return UNSUPPORTED;
    }
    const answer = await this.read(`chunks/${address}`, options);
    if (answer.kind === 'content' && answer.bytes.length < SPAN_LENGTH) {
      return notReady('answered fewer bytes than a span');
    }
    return answer;
  }

  async readChunk(address: string, options?: ReadOptions): Promise<SwarmAnswer> {
    const answer = await this.read(`chunks/${address}`, options);
    if (answer.kind === 'content' && !isContentAddressedAt(answer.bytes, address)) {
      return UNSUPPORTED;
    }
    return answer;
  }

  async readBytes(reference: string, options?: ReadOptions): Promise<SwarmAnswer> {
    return withoutSpan(await this.read(`bytes/${reference}`, options));
  }

  /**
   * A segment's URL is weeb-3's caching route, absolute because it is written into a playlist. A
   * picture's is weeb-3's manifest route on this page, which the page loads itself.
   */
  urlFor(reference: string, use: UrlUse): string | null {
    if (use === 'thumbnail') {
      return `${WEEB3_PATH}bzz/${encodeURIComponent(reference.trim())}/`;
    }
    return new URL(`${WEEB3_PATH}hls/bytes/${reference}`, this.pageOrigin).href;
  }

  status(): ProviderStatus {
    const { state, peers, download } = this.runtime.status();
    const status = { state, peers, healthyPeers: WEEB3_HEALTHY_PEERS };
    return download ? { ...status, download } : status;
  }

  /**
   * weeb-3 plays a stream with its own player on the page's node. Loading it holds the node, starting it
   * if nothing has, and answers once the node is ready. The page shows no quality menu, so the player is
   * set to choose its quality itself, as the app's own player does.
   */
  readonly ownPlayer = async (): Promise<OwnPlayer> => {
    const { runtime } = this;
    let node: Weeb3Node;
    try {
      void runtime.acquire().catch(() => undefined);
      node = await runtime.whenReady();
    } catch (error) {
      runtime.release();
      throw error;
    }
    let held = true;
    return {
      attach: async (video, owner, topic, from) => {
        await node.attachStream(video, owner, topic, from);
        chooseQualityItself(node, video);
      },
      detach: () => {
        if (held) {
          held = false;
          runtime.release();
        }
      },
    };
  };

  /** Never reads the network and never starts the node: its own state says whether it can serve. */
  async probe(): Promise<ProbeResult> {
    const { state } = this.runtime.status();
    switch (state) {
      case 'ready':
        return { kind: 'ok', elapsedMs: 0 };
      case 'failed':
        return { kind: 'unreachable' };
      case 'lost':
        return { kind: 'not-ready', reason: { kind: 'no-peers' } };
      case 'stopped':
      case 'starting':
        return { kind: 'not-ready', reason: { kind: 'starting' } };
    }
  }

  /** Holds the page's node, starting it if nothing held it. Each start is let go by one stop. */
  async start(): Promise<void> {
    await this.runtime.acquire();
  }

  async stop(): Promise<void> {
    this.runtime.release();
  }

  readonly restart = (): void => this.runtime.restart();

  private async readSocAt(identifier: Identifier, owner: string, options?: ReadOptions): Promise<SwarmAnswer> {
    let address: string;
    try {
      address = singleOwnerChunkAddress(identifier, owner);
    } catch {
      return UNSUPPORTED;
    }
    return withoutSpan(await this.read(`chunks/${address}`, options));
  }

  private async read(path: string, options: ReadOptions = {}): Promise<SwarmAnswer> {
    const { signal } = options;
    if (signal?.aborted) {
      return ABORTED;
    }
    const url = new URL(`${WEEB3_PATH}${path}`, this.pageOrigin).href;
    switch (this.runtime.status().state) {
      case 'ready':
        return httpRead(url, { ...options, fetcher: this.fetcher });
      case 'lost':
        return { kind: 'unavailable', cause: { kind: 'network', error: new Error(WEEB3_LOST_PEERS) } };
    }
    const { runtime } = this;
    try {
      const ready = untilAborted(
        runtime.acquire().then(() => runtime.whenReady()),
        signal,
      );
      if ((await ready) === null) {
        return ABORTED;
      }
      return await httpRead(url, { ...options, fetcher: this.fetcher });
    } catch {
      return notReady('could not start');
    } finally {
      runtime.release();
    }
  }
}
