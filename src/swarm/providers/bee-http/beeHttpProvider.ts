import { FeedIndex, type Topic } from '@ethersphere/bee-js';

import { makeFeedIdentifier, nextFeedRequest } from '@/shared/feedFollow';
import { type SwarmAnswer, UNSUPPORTED } from '../../answers';
import { ABSENT, type AbsentStatuses, httpRead, isSuccess } from '../../httpRead';
import {
  PROBE_TIMEOUT_MS,
  type ProbeResult,
  type ProviderCapabilities,
  type ProviderStatus,
  type ReadOptions,
  type SwarmProvider,
  type UrlUse,
} from '../../provider';
import { boundedRequest } from '../../boundedRequest';
import { notReadyReasonOf } from './beeNodeState';

/** Bee answers this with `{"status":"ok",...}` in every version this viewer has targeted. */
const HEALTH_PATH = 'health';
const READINESS_PATH = 'readiness';
const PEERS_PATH = 'peers';

export { LONGEST_RETRY_AFTER_MS } from '../../httpRead';

/** What Bee answers `GET /chunks` with for a chunk it could not find, a chat slot never written among them. */
const CHUNK_NOT_RETRIEVED = 500;

const ABSENT_CHUNK: AbsentStatuses = new Set([...ABSENT, CHUNK_NOT_RETRIEVED]);

const CAPABILITIES: ProviderCapabilities = {
  feedHead: true,
  feedEntry: true,
  soc: true,
  chunk: true,
  bytes: true,
  urls: true,
  inTab: false,
};

const READY: ProviderStatus = { state: 'ready' };

export interface BeeHttpProviderOptions {
  /** A Bee API base: an http or https address, or a path on this site such as `/bee` that the site proxies to Bee. */
  readonly baseUrl: string;
  /** Injected by tests. The global `fetch` otherwise. */
  readonly fetcher?: typeof fetch;
  /** The page's own origin, which a gateway given as a path on this site is resolved against for a URL. */
  readonly pageOrigin?: string;
}

function looksLikeBeeHealth(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === 'object' && parsed !== null && typeof (parsed as { status?: unknown }).status === 'string';
  } catch {
    return false;
  }
}

function currentPageOrigin(): string {
  return typeof location === 'undefined' ? 'http://localhost' : location.origin;
}

/**
 * A Bee node's HTTP API, the way the app has always read the event gateway: the same paths, so a
 * recorded replay of the app's traffic still matches. A 404 is content that is not there and a 429 is
 * the node asking to be left alone. Any other status that is not a success is a fault of the node,
 * a 500 included, because Bee answers 500 for a chunk it failed to fetch from the network as well as
 * for its own trouble, and the two cannot be told apart from here. A chunk read is the one exception,
 * see {@link BeeHttpProvider.readChunk}.
 */
export class BeeHttpProvider implements SwarmProvider {
  readonly capabilities = CAPABILITIES;

  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly pageOrigin: string;

  constructor(options: BeeHttpProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    // Handed on as a value and called bare by `boundedRequest`, never as this object's method, which the
    // browser's fetch would refuse as an illegal invocation.
    this.fetcher = options.fetcher ?? fetch;
    this.pageOrigin = options.pageOrigin ?? currentPageOrigin();
  }

  readFeedHead(owner: string, topic: Topic, options?: ReadOptions): Promise<SwarmAnswer> {
    return this.read(nextFeedRequest(owner, topic, null).path, options);
  }

  /**
   * A feed entry is the single-owner chunk its owner wrote under the topic and index together. An index
   * that is not a whole number from zero up names no entry, and bee-js would throw building one.
   */
  async readFeedEntry(owner: string, topic: Topic, index: number, options?: ReadOptions): Promise<SwarmAnswer> {
    if (!Number.isSafeInteger(index) || index < 0) {
      return UNSUPPORTED;
    }
    return this.readSoc(owner, makeFeedIdentifier(topic, FeedIndex.fromBigInt(BigInt(index))).toString(), options);
  }

  readSoc(owner: string, identifier: string, options?: ReadOptions): Promise<SwarmAnswer> {
    return this.read(`soc/${owner}/${identifier}`, options);
  }

  /**
   * A 500 here is not there rather than a fault, because an idle chat asks for its next slot before
   * anyone writes it, and taking each of those as a fault would pause the node and send the chat to
   * the fallback. The library the chat runs on reads the status the same way.
   */
  readChunk(address: string, options?: ReadOptions): Promise<SwarmAnswer> {
    return this.read(`chunks/${address}`, options, ABSENT_CHUNK);
  }

  readBytes(reference: string, options?: ReadOptions): Promise<SwarmAnswer> {
    return this.read(`bytes/${reference}`, options);
  }

  /**
   * A segment's URL is absolute because it is written into a playlist, and hls.js resolves a playlist's
   * lines against the playlist's own URL, which here is a `memory:` or a `swarm://` URI. A picture's is
   * left as the gateway was given, because the page itself loads it. Its reference is encoded because
   * it comes from the stream list, external input, and its trailing slash makes Bee serve the uploaded
   * file rather than redirect.
   */
  urlFor(reference: string, use: UrlUse): string | null {
    if (use === 'thumbnail') {
      return `${this.baseUrl}/bzz/${encodeURIComponent(reference.trim())}/`;
    }
    return new URL(`${this.baseUrl}/bytes/${reference}`, this.pageOrigin).href;
  }

  status(): ProviderStatus {
    return READY;
  }

  /**
   * Asks `/health`, and beside it `/readiness` and `/peers`, so a node that is there and cannot serve
   * reads yet is told apart in the same round trip. When nothing readable comes back, a second request
   * with `mode: 'no-cors'` asks whether anything answered at all: a browser answers that one opaquely
   * whatever the node's CORS settings, and rejects it only when nothing is there.
   */
  async probe(options: ReadOptions = {}): Promise<ProbeResult> {
    const startedAt = Date.now();
    const ask = (path: string, init?: RequestInit) =>
      boundedRequest(`${this.baseUrl}/${path}`, {
        fetcher: this.fetcher,
        timeoutMs: options.timeoutMs ?? PROBE_TIMEOUT_MS,
        signal: options.signal,
        readsBody: isSuccess,
        init,
      });
    const [health, readiness, peers] = await Promise.all([ask(HEALTH_PATH), ask(READINESS_PATH), ask(PEERS_PATH)]);
    switch (health.kind) {
      case 'response': {
        const { response, body } = health;
        if (!isSuccess(response.status)) {
          return { kind: 'rejected', status: response.status };
        }
        if (!looksLikeBeeHealth(new TextDecoder().decode(body ?? new Uint8Array()))) {
          return { kind: 'not-swarm' };
        }
        const reason = notReadyReasonOf(body, readiness, peers);
        return reason === null ? { kind: 'ok', elapsedMs: Date.now() - startedAt } : { kind: 'not-ready', reason };
      }
      case 'timed-out':
        return { kind: 'timed-out' };
      case 'aborted':
        return { kind: 'unreachable' };
      case 'failed': {
        const opaque = await ask(HEALTH_PATH, { mode: 'no-cors' });
        return opaque.kind === 'response' ? { kind: 'refuses-this-site' } : { kind: 'unreachable' };
      }
    }
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  private read(path: string, options: ReadOptions = {}, absent?: AbsentStatuses): Promise<SwarmAnswer> {
    return httpRead(`${this.baseUrl}/${path}`, { ...options, fetcher: this.fetcher, absent });
  }
}
