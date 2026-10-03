/**
 * Feed and single-owner chunk reads through the Swarm node of the browser this page runs in, rather
 * than through the event gateway.
 *
 * Freedom injects `window.swarm` into every page it shows. Its `swarm_readFeedEntry` and
 * `swarm_readSingleOwnerChunk` read public Swarm data from the browser's own node without asking the
 * viewer anything, so with segments already on that node over `bzz://` (see
 * `features/player/browserNode`) nothing a viewer watches has to touch the gateway.
 *
 * **Freedom limits these reads per site**: 120 requests and 512 KiB a minute for a site the viewer
 * has not connected, and 600 requests and 5 MiB for one they have (`READ_BUDGETS` in Freedom's
 * `src/main/swarm/swarm-provider-ipc.js`). Connecting is `swarm_requestAccess`, which shows Freedom's
 * connection prompt. A read over the limit is refused with `rate_limited`, and so is every read after
 * it until the minute is up. So a refusal pauses this route for that minute and the reads go to the
 * gateway meanwhile, which is slower to give up on than the node and was where they went before.
 * Anything else the node cannot answer goes to the gateway the same way, after a shorter pause.
 *
 * Only ever on while segments come from the browser's node, which is only offered on a `bzz:` page.
 * Everywhere else every read goes to the gateway exactly as before.
 */

import { feedSlotOf } from '@/shared/feedFollow';
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  FetchWithTimeoutOptions,
  TimedResponse,
} from '@/shared/fetchWithTimeout';

/** The part of Freedom's `window.swarm` this module uses. */
export interface SwarmProvider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}

/** What `window.swarm.request` rejects with: an `Error` carrying the JSON-RPC style code and data. */
interface ProviderError {
  code?: number;
  data?: { reason?: string; windowMs?: number };
}

/** The provider this page was given, or null in any browser that gives none. */
export function swarmProvider(): SwarmProvider | null {
  const candidate = (globalThis as { swarm?: { request?: unknown } }).swarm;
  return typeof candidate?.request === 'function' ? (candidate as SwarmProvider) : null;
}

/** A gateway path this route can read, which is every path `feedFollow` builds. */
type ParsedPath = { kind: 'head'; owner: string; topic: string } | { kind: 'slot'; owner: string; identifier: string };

const FEED_PATH = /(?:^|\/)(feeds|soc)\/(?:0x)?([0-9a-f]{40})\/([0-9a-f]{64})$/i;

function parsePath(url: string): ParsedPath | null {
  const match = FEED_PATH.exec(url);
  if (!match) {
    return null;
  }
  const [, kind, owner, hex] = match;
  return kind === 'feeds' ? { kind: 'head', owner, topic: hex } : { kind: 'slot', owner, identifier: hex };
}

/** Freedom's window for both budgets, used when a refusal does not say. */
const READ_BUDGET_WINDOW_MS = 60_000;

/**
 * How long a node that failed in some other way is left alone. Long enough that a node still
 * starting up is not asked again for every read, short enough that playback is back on it soon.
 */
export const NODE_RETRY_MS = 15_000;

/** The reasons Freedom gives for a slot or feed that does not exist, which a gateway answers 404. */
const NOT_FOUND_REASONS = new Set(['entry_not_found', 'feed_empty', 'chunk_not_found']);

/** Freedom's code for a method its provider does not have, as in a version older than these reads. */
const UNSUPPORTED_METHOD = 4200;

/** A chunk's payload limit. A single-owner chunk with a larger span holds the root of a tree. */
const CHUNK_PAYLOAD_BYTES = 4096;

/** The header a gateway's `/feeds` read names its slot in, zero-padded hexadecimal. */
const FEED_INDEX_HEADER = 'swarm-feed-index';

class NodeTimeoutError extends Error {}

/** Whether the viewer has connected this site in Freedom, which raises its read budget. */
export type BrowserNodeAccess = 'connected' | 'not-connected' | 'unknown';

export class BrowserNodeFeeds {
  /** Set by the app provider: on while segments come from the browser's own node. */
  enabled = false;

  /** Reads go to the gateway until this time. */
  private pausedUntil = 0;

  /** Set when the provider lacks these reads, which no later read can change. */
  private unsupported = false;

  constructor(
    /** Injected only by tests. */
    private readonly provider: () => SwarmProvider | null = swarmProvider,
    /** Injected only by tests, so a pause is driven rather than waited out. */
    private readonly now: () => number = Date.now,
    private readonly timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
  ) {}

  /** Whether reads would be tried on the node now, rather than going to the gateway. */
  isActive(): boolean {
    return this.enabled && !this.unsupported && this.provider() !== null;
  }

  /**
   * The answer the browser's node gives for a gateway URL, shaped as the gateway's would be, or null
   * when the read should go to the gateway: this route is off or paused, the URL is not a feed read,
   * or the node could not answer it.
   */
  async read(url: string, signal?: AbortSignal): Promise<TimedResponse | null> {
    const provider = this.provider();
    if (!this.enabled || this.unsupported || provider === null || this.now() < this.pausedUntil) {
      return null;
    }
    const path = parsePath(url);
    if (path === null) {
      return null;
    }

    try {
      return await this.readPath(provider, path, signal);
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      return this.fallBack(error);
    }
  }

  /**
   * Asks Freedom to connect this site, which shows its prompt unless the viewer already did.
   *
   * @returns whether the site is connected afterwards. A viewer who declines leaves it as it was.
   */
  async requestAccess(): Promise<boolean> {
    const provider = this.provider();
    if (provider === null) {
      return false;
    }
    try {
      const result = (await provider.request({ method: 'swarm_requestAccess' })) as { connected?: boolean } | null;
      if (result?.connected === true) {
        // The refusal that paused reads counted against the smaller budget.
        this.pausedUntil = 0;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Whether this site is connected, asked in the one way that never shows the viewer a prompt. */
  async access(): Promise<BrowserNodeAccess> {
    const provider = this.provider();
    if (provider === null) {
      return 'unknown';
    }
    try {
      const result = (await provider.request({ method: 'swarm_getCapabilities' })) as { reason?: string } | null;
      return result?.reason === 'not-connected' ? 'not-connected' : 'connected';
    } catch {
      return 'unknown';
    }
  }

  private async readPath(
    provider: SwarmProvider,
    path: ParsedPath,
    signal?: AbortSignal,
  ): Promise<TimedResponse | null> {
    if (path.kind === 'head') {
      const entry = await this.call(provider, 'swarm_readFeedEntry', { topic: path.topic, owner: path.owner }, signal);
      return feedEntryResponse(entry, true);
    }

    const slot = feedSlotOf(path.identifier);
    if (slot !== null) {
      const index = Number(slot.index.toBigInt());
      if (Number.isSafeInteger(index)) {
        const entry = await this.call(
          provider,
          'swarm_readFeedEntry',
          { topic: slot.topic.toString(), owner: path.owner, index },
          signal,
        );
        return feedEntryResponse(entry, false);
      }
    }

    // A slot this tab did not build, so its topic and index are unknown. The chunk itself can still
    // be read, but on its own it is only the content when that fits in the one chunk.
    const chunk = (await this.call(
      provider,
      'swarm_readSingleOwnerChunk',
      { owner: path.owner, identifier: path.identifier },
      signal,
    )) as { data?: string; span?: number | bigint } | null;
    if (typeof chunk?.data !== 'string' || chunk.span === undefined || Number(chunk.span) > CHUNK_PAYLOAD_BYTES) {
      return null;
    }
    return { ok: true, status: 200, headers: new Headers(), text: decodeBase64(chunk.data) };
  }

  /** One provider request, bounded like a gateway read and given up on when the caller cancels. */
  private call(provider: SwarmProvider, method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason ?? new Error('Request was cancelled before it started'));
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => finish(() => reject(signal?.reason ?? new Error('Request was cancelled')));
      const timer = setTimeout(
        () => finish(() => reject(new NodeTimeoutError(`${method} timed out after ${this.timeoutMs}ms`))),
        this.timeoutMs,
      );
      let settled = false;
      function finish(settle: () => void) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        settle();
      }
      signal?.addEventListener('abort', onAbort);
      provider.request({ method, params }).then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    });
  }

  /** What a failed read becomes: a gateway's 404 for a slot that is not there, or a read for the gateway. */
  private fallBack(error: unknown): TimedResponse | null {
    const { code, data } = (error ?? {}) as ProviderError;
    if (data?.reason !== undefined && NOT_FOUND_REASONS.has(data.reason)) {
      return { ok: false, status: 404, headers: new Headers(), text: '' };
    }
    if (data?.reason === 'rate_limited') {
      this.pausedUntil = this.now() + (data.windowMs ?? READ_BUDGET_WINDOW_MS);
      console.warn(
        "This browser's node refused a feed read over this site's read limit. Reading feeds from the gateway for a minute.",
      );
      return null;
    }
    if (code === UNSUPPORTED_METHOD) {
      this.unsupported = true;
      return null;
    }
    this.pausedUntil = this.now() + NODE_RETRY_MS;
    console.warn("This browser's node could not read a feed. Reading feeds from the gateway for a while.", error);
    return null;
  }
}

/**
 * A feed entry as a gateway would have answered its path.
 *
 * @param named whether to name the slot in the header the way a gateway's `/feeds` read does. A
 *   `/soc` read names none, so a slot read does not either.
 */
function feedEntryResponse(entry: unknown, named: boolean): TimedResponse | null {
  const { data, index } = (entry ?? {}) as { data?: unknown; index?: unknown };
  if (typeof data !== 'string') {
    return null;
  }
  const headers = new Headers();
  if (named) {
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) {
      // A head read is only worth its slot number, which every follower starts its walk from.
      return null;
    }
    headers.set(FEED_INDEX_HEADER, index.toString(16).padStart(16, '0'));
  }
  return { ok: true, status: 200, headers, text: decodeBase64(data) };
}

function decodeBase64(data: string): string {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/** The one instance the app provider switches and every feed read goes through. */
export const browserNodeFeeds = new BrowserNodeFeeds();

/**
 * `fetchWithTimeout` for a feed or slot URL, answered by the browser's node when that route is on and
 * by the gateway otherwise. Takes and returns exactly what `fetchWithTimeout` does, so a caller swaps
 * one for the other.
 */
export async function fetchFeed(
  url: string,
  options: FetchWithTimeoutOptions = {},
  feeds: BrowserNodeFeeds = browserNodeFeeds,
): Promise<TimedResponse> {
  return (await feeds.read(url, options.signal)) ?? fetchWithTimeout(url, options);
}
