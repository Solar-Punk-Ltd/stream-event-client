import { ChunkBuilder, FeedIndex, Identifier, Span, type Topic } from '@ethersphere/bee-js';

import { makeFeedIdentifier } from '@/shared/feedFollow';
import { type SwarmAnswer, UNSUPPORTED } from '../../answers';
import { httpRead } from '../../httpRead';
import type {
  OwnPlayer,
  ProbeResult,
  ProviderCapabilities,
  ProviderStatus,
  ReadOptions,
  SwarmProvider,
  UrlUse,
} from '../../provider';
import { MAX_CHUNK_PAYLOAD, singleOwnerChunkAddress } from '../../singleOwnerChunk';
import { WEEB3_PATH, type Weeb3Runtime } from './weeb3Runtime';

const CAPABILITIES: ProviderCapabilities = {
  feedHead: false,
  feedEntry: true,
  soc: true,
  chunk: true,
  bytes: true,
  urls: true,
  inTab: true,
};

const SPAN_LENGTH = 8;

/** What the provider needs of the page's node: where it is, and a way to start and stop it. */
export type Weeb3RuntimeView = Pick<Weeb3Runtime, 'status' | 'start' | 'stop'>;

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

const notReady = (state: string): SwarmAnswer => ({
  kind: 'unavailable',
  cause: { kind: 'network', error: new Error(`the node in this browser is ${state}`) },
});

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

/**
 * Swarm read through the node running in this browser, weeb-3, over the routes its service worker
 * answers on this page. A missing chunk is a 404 there, after weeb-3 has asked the network for about
 * 17 s, so a read with the default window ends as a timeout first.
 *
 * Every chunk and bytes answer starts with the span, which Bee's `/soc` and `/bytes` leave out, so it
 * is taken off. A single-owner chunk comes back as its span and payload without the identifier and
 * signature that prove it its owner's, so it is read as the payload of `/soc` is, and a whole chunk is
 * served only where it is content-addressed and its address can be checked here.
 */
export class Weeb3Provider implements SwarmProvider {
  readonly capabilities = CAPABILITIES;

  private readonly runtime: Weeb3RuntimeView;
  private readonly fetcher: typeof fetch;
  private readonly pageOrigin: string;

  constructor(options: Weeb3ProviderOptions) {
    this.runtime = options.runtime;
    // Handed on as a value and called bare by `boundedRequest`, never as this object's method, which the
    // browser's fetch would refuse as an illegal invocation.
    this.fetcher = options.fetcher ?? fetch;
    this.pageOrigin = options.pageOrigin ?? currentPageOrigin();
  }

  /** weeb-3's feed route is its own player's playlist and reports no index, so the client asks another provider. */
  async readFeedHead(_owner: string, _topic: Topic, _options?: ReadOptions): Promise<SwarmAnswer> {
    return UNSUPPORTED;
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
    const { state, peers } = this.runtime.status();
    return { state, peers };
  }

  /** weeb-3 plays a stream with its own player on the page's node, which this starts if nothing has yet. */
  readonly ownPlayer = async (): Promise<OwnPlayer> => {
    const node = await this.runtime.start();
    return { attach: (video, owner, topic, from) => node.attachStream(video, owner, topic, from) };
  };

  /** Never reads the network: the node's own state says whether it can serve, and a stopped node is started. */
  async probe(): Promise<ProbeResult> {
    const { state } = this.runtime.status();
    switch (state) {
      case 'ready':
        return { kind: 'ok', elapsedMs: 0 };
      case 'failed':
        return { kind: 'unreachable' };
      case 'stopped':
        this.startQuietly();
        return { kind: 'not-ready', reason: { kind: 'starting' } };
      case 'starting':
        return { kind: 'not-ready', reason: { kind: 'starting' } };
    }
  }

  async start(): Promise<void> {
    await this.runtime.start();
  }

  async stop(): Promise<void> {
    await this.runtime.stop();
  }

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
    const { state } = this.runtime.status();
    if (state !== 'ready') {
      if (state === 'stopped') {
        this.startQuietly();
      }
      return options.signal?.aborted ? { kind: 'aborted' } : notReady(state);
    }
    return httpRead(new URL(`${WEEB3_PATH}${path}`, this.pageOrigin).href, { ...options, fetcher: this.fetcher });
  }

  /** A failed start shows in {@link status}, so nobody here waits on it. */
  private startQuietly(): void {
    this.runtime.start().catch(() => undefined);
  }
}
