/**
 * Feed and single-owner chunk reads through the Swarm node of the browser this page runs in, rather
 * than through the event gateway.
 *
 * Freedom injects `window.swarm` into every page it shows. Its `swarm_readFeedEntry` and
 * `swarm_readSingleOwnerChunk` read public Swarm data from the browser's own node without asking the
 * viewer anything, so with segments already on that node over `bzz://` (see
 * `features/player/browserNode`) the gateway is left only what the node cannot answer.
 *
 * **Freedom limits these reads per site**: 120 requests and 512 KiB a minute for a site the viewer
 * has not connected, and 600 requests and 5 MiB for one they have (`READ_BUDGETS` in Freedom's
 * `src/main/swarm/swarm-provider-ipc.js`). Connecting is `swarm_requestAccess`, which shows Freedom's
 * connection prompt. A read over the limit is refused with `rate_limited`, and so is every read after
 * it until the minute is up. So a refusal pauses this route for that minute and the reads go to the
 * gateway meanwhile, which is slower to give up on than the node and was where they went before.
 * Anything else the node cannot answer goes to the gateway the same way, after a shorter pause.
 *
 * The byte budget is counted after the node has read the whole payload, so a single payload larger
 * than it, such as a finished stream's playlist on a site that is not connected, is refused every
 * time and only after the node has spent its time joining it. The first such refusal costs that
 * once. When the gateway's answer to the same read then turns out larger than the budget, that read
 * goes straight to the gateway from then on, until the viewer connects the site.
 *
 * Freedom answers a feed slot it could not retrieve the same way as one that does not exist. A
 * node's "not found" is the 404 a follower at the live edge expects, so it is passed on, and the
 * slot's next poll goes to the gateway instead of the node, whose answer tells the two apart. Its 404
 * sends the poll after back to the node. So polls of a missing slot alternate between the node and
 * the gateway, and none costs both: a node miss is slow (about two seconds) and counts against the
 * read budget, so asking the gateway behind it would make every poll the slowest and dearest there
 * is. Counted in polls rather than time, because the time between two polls of a slot is mostly the
 * node's own miss. Every second poll is within anything the player concludes from a slot staying
 * missing: it probes past one after `UNSERVED_POLLS_BEFORE_PROBE` (3) polls.
 *
 * A slot the gateway serves after the node refused it is either a slot written during the node's
 * slow lookup or a node failing the feed. At the live edge the first is the rule rather than the
 * exception: the first poll of every slot goes to the node, which takes about two seconds to give up,
 * by when the next two-to-four-second segment has often been written. So a run of such slots proves
 * nothing on its own. After {@link FAILED_SLOTS_BEFORE_DISTRUST} of them in a row, with neither a
 * node read nor a gateway 404 of the feed between them, the node is asked again for the last one,
 * which the gateway has just shown exists. A node that serves it was only racing the writer. A node
 * that refuses it again is failing the feed, and the feed's slots are then read from the gateway
 * alone until it answers one 404, which puts the follower at the live edge where the node is tried
 * again, or for {@link NODE_RETRY_MS} at most. While that question is open the feed's slots go to the
 * gateway, so a follower behind the edge spends no node miss on it.
 *
 * A feed head the node calls empty is asked of the gateway, and while the gateway agrees it is
 * empty, the head is read from the gateway alone, until the gateway serves it. A head is read once
 * when a follower joins and every few seconds by the catalog, where a believed "not found" would show
 * "no streams" until the next poll, and where a stream that has not started would otherwise cost a
 * slow node miss on top of the gateway read on every poll.
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
  data?: { reason?: string; windowMs?: number; maxBytes?: number };
}

/** The provider this page was given, or null in any browser that gives none. */
export function swarmProvider(): SwarmProvider | null {
  const candidate = (globalThis as { swarm?: { request?: unknown } }).swarm;
  return typeof candidate?.request === 'function' ? (candidate as SwarmProvider) : null;
}

/** A gateway path this route can read, which is every path `feedFollow` builds. */
type ParsedPath = { kind: 'head'; owner: string; topic: string } | { kind: 'slot'; owner: string; identifier: string };

const FEED_PATH = /(?:^|\/)(feeds|soc)\/(?:0x)?([0-9a-f]{40})\/([0-9a-f]{64})$/i;

/** One read's identity, the same for every gateway URL that names the same feed path. */
function readKey(path: ParsedPath): string {
  const hex = path.kind === 'head' ? path.topic : path.identifier;
  return `${path.kind}/${path.owner.toLowerCase()}/${hex.toLowerCase()}`;
}

/** Adds to a set that is cleared rather than left to grow when a page stays open for days. */
function remember(set: Set<string>, key: string): void {
  if (set.size >= REMEMBERED_READS) {
    set.clear();
  }
  set.add(key);
}

/** {@link remember} for a key that carries a time. */
function rememberAt(map: Map<string, number>, key: string, at: number): void {
  if (map.size >= REMEMBERED_READS && !map.has(key)) {
    map.clear();
  }
  map.set(key, at);
}

/** The feed a slot read belongs to, when this tab built its path and so knows the topic. */
function feedKey(path: ParsedPath): string | null {
  const topic = path.kind === 'head' ? path.topic : feedSlotOf(path.identifier)?.topic.toString();
  return topic === undefined ? null : `${path.owner.toLowerCase()}/${topic.toLowerCase()}`;
}

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

/**
 * The reasons Freedom gives for a slot or feed that does not exist, which a gateway answers 404.
 * Freedom gives them for a Bee 500 as well, which is a retrieval failure rather than an absence.
 */
const NOT_FOUND_REASONS = new Set(['entry_not_found', 'feed_empty', 'chunk_not_found']);

/**
 * How many slots of a feed in a row the gateway has to serve after the node refused them before the
 * node is asked again for the last of them, whose answer decides whether the feed is read from the
 * gateway alone.
 */
export const FAILED_SLOTS_BEFORE_DISTRUST = 2;

/** Freedom's byte budget for a site the viewer has not connected, used when a refusal does not say. */
const ANONYMOUS_READ_BYTES = 512 * 1024;

/** Bounds the per-read memory below, which only ever needs the slots a follower is waiting on. */
const REMEMBERED_READS = 256;

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

  /** Reads go to the gateway until this time, after the browser refused one over its read budget. */
  private budgetPausedUntil = 0;

  /** Reads go to the gateway until this time, after the node failed to answer one. */
  private nodePausedUntil = 0;

  /** The last read refused over the budget, kept until the gateway's answer says how large it is. */
  private refusedOverBudget: { key: string; maxBytes: number } | null = null;

  /** Reads larger than the site's byte budget, which the browser would refuse every time. */
  private readonly overBudget = new Set<string>();

  /** Slots the node refused on their last poll, whose next poll goes to the gateway. */
  private readonly refusedSlots = new Set<string>();

  /** Slots handed to the gateway because the node refused them, until the gateway answers. */
  private readonly checking = new Set<string>();

  /** Per feed, how many slots in a row the gateway served after the node refused them. */
  private readonly failedSlots = new Map<string, number>();

  /** Feeds read from the gateway alone, by when that began. */
  private readonly distrusted = new Map<string, number>();

  /** Feeds whose node is being asked again for a slot the gateway served after the node refused it. */
  private readonly confirming = new Set<string>();

  /** Feed heads the node called empty and the gateway agreed, read from the gateway alone. */
  private readonly emptyHeads = new Set<string>();

  /** Set when the provider lacks these reads, which no later read can change. */
  private unsupported = false;

  constructor(
    /** Injected only by tests. */
    private readonly provider: () => SwarmProvider | null = swarmProvider,
    /** Injected only by tests, so a pause is driven rather than waited out. */
    private readonly now: () => number = Date.now,
    private readonly timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
  ) {}

  /**
   * The answer the browser's node gives for a gateway URL, shaped as the gateway's would be, or null
   * when the read should go to the gateway: this route is off or paused, the URL is not a feed read,
   * or the node could not answer it.
   */
  async read(url: string, signal?: AbortSignal): Promise<TimedResponse | null> {
    const provider = this.provider();
    const now = this.now();
    if (
      !this.enabled ||
      this.unsupported ||
      provider === null ||
      now < this.budgetPausedUntil ||
      now < this.nodePausedUntil
    ) {
      return null;
    }
    const path = parsePath(url);
    if (path === null) {
      return null;
    }
    const key = readKey(path);
    if (this.overBudget.has(key) || this.emptyHeads.has(key)) {
      return null;
    }
    const feed = feedKey(path);
    if (path.kind === 'slot') {
      if (this.refusedSlots.delete(key)) {
        remember(this.checking, key);
        return null;
      }
      const distrustedAt = feed === null ? undefined : this.distrusted.get(feed);
      if (
        (distrustedAt !== undefined && now - distrustedAt < NODE_RETRY_MS) ||
        (feed !== null && this.confirming.has(feed))
      ) {
        return null;
      }
    }

    try {
      const response = await this.readPath(provider, path, signal);
      if (feed !== null && response !== null) {
        this.failedSlots.delete(feed);
      }
      return response;
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      return this.fallBack(error, path, key);
    }
  }

  /**
   * Tells this route what the gateway answered for a read it handed over, which is the only place a
   * refused read's size can be learned. Called by {@link fetchFeed}.
   */
  noteGatewayAnswer(url: string, response: TimedResponse): void {
    const path = parsePath(url);
    if (path === null) {
      return;
    }
    const key = readKey(path);
    const feed = feedKey(path);
    if (path.kind === 'head') {
      if (response.status === 404) {
        remember(this.emptyHeads, key);
      } else {
        this.emptyHeads.delete(key);
      }
    } else if (feed !== null && response.status === 404) {
      // The gateway has not got this slot either, so the follower is at the live edge.
      this.failedSlots.delete(feed);
      this.distrusted.delete(feed);
    }
    if (this.checking.delete(key) && feed !== null && response.ok) {
      const failed = (this.failedSlots.get(feed) ?? 0) + 1;
      if (failed >= FAILED_SLOTS_BEFORE_DISTRUST) {
        this.failedSlots.delete(feed);
        void this.confirmRefusal(path, key, feed);
      } else {
        rememberAt(this.failedSlots, feed, failed);
      }
    }
    const refused = this.refusedOverBudget;
    if (refused === null || key !== refused.key) {
      return;
    }
    this.refusedOverBudget = null;
    if (response.ok && new TextEncoder().encode(response.text).length > refused.maxBytes) {
      remember(this.overBudget, refused.key);
      console.warn(
        "A feed read is larger than this site's read limit in this browser, so it is read from the gateway. Connecting the site raises the limit.",
      );
    }
  }

  /**
   * Tells this route a gateway read it handed over failed without an answer, so the slot is no longer
   * waiting on one. Called by {@link fetchFeed}.
   */
  noteGatewayFailure(url: string): void {
    const path = parsePath(url);
    if (path !== null) {
      this.checking.delete(readKey(path));
    }
  }

  /**
   * Asks the node again for a slot the gateway has just served after the node refused it, and reads
   * the feed from the gateway alone if the node refuses it again.
   */
  private async confirmRefusal(path: ParsedPath, key: string, feed: string): Promise<void> {
    const provider = this.provider();
    const now = this.now();
    if (
      !this.enabled ||
      this.unsupported ||
      provider === null ||
      now < this.budgetPausedUntil ||
      now < this.nodePausedUntil ||
      this.confirming.has(feed)
    ) {
      return;
    }
    remember(this.confirming, feed);
    try {
      await this.readPath(provider, path);
    } catch (error) {
      const reason = ((error ?? {}) as ProviderError).data?.reason;
      if (reason !== undefined && NOT_FOUND_REASONS.has(reason)) {
        rememberAt(this.distrusted, feed, this.now());
      } else {
        this.fallBack(error, path, key);
      }
    } finally {
      this.confirming.delete(feed);
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
        // The refusal that paused reads, and every read found too large, counted against the smaller
        // budget. A pause for a node that failed is about the node, which connecting does not change.
        this.budgetPausedUntil = 0;
        this.overBudget.clear();
        this.refusedOverBudget = null;
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
  private fallBack(error: unknown, path: ParsedPath, key: string): TimedResponse | null {
    const { code, data } = (error ?? {}) as ProviderError;
    if (data?.reason !== undefined && NOT_FOUND_REASONS.has(data.reason)) {
      if (path.kind === 'head') {
        return null;
      }
      remember(this.refusedSlots, key);
      return { ok: false, status: 404, headers: new Headers(), text: '' };
    }
    if (data?.reason === 'rate_limited') {
      this.budgetPausedUntil = this.now() + (data.windowMs ?? READ_BUDGET_WINDOW_MS);
      this.refusedOverBudget = { key, maxBytes: data.maxBytes ?? ANONYMOUS_READ_BYTES };
      console.warn(
        "This browser's node refused a feed read over this site's read limit. Reading feeds from the gateway for a minute.",
      );
      return null;
    }
    if (code === UNSUPPORTED_METHOD) {
      this.unsupported = true;
      return null;
    }
    this.nodePausedUntil = this.now() + NODE_RETRY_MS;
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
  const fromNode = await feeds.read(url, options.signal);
  if (fromNode !== null) {
    return fromNode;
  }
  let fromGateway: TimedResponse;
  try {
    fromGateway = await fetchWithTimeout(url, options);
  } catch (error) {
    feeds.noteGatewayFailure(url);
    throw error;
  }
  feeds.noteGatewayAnswer(url, fromGateway);
  return fromGateway;
}
