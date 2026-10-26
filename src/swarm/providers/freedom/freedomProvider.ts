import { Bytes, Span, type Topic } from '@ethersphere/bee-js';

import { ABORTED, type SwarmAnswer, UNSUPPORTED } from '../../answers';
import { SPAN_LENGTH } from '../../chunkSpan';
import { LONGEST_RETRY_AFTER_MS } from '../../httpRead';
import {
  DEFAULT_READ_TIMEOUT_MS,
  PROBE_TIMEOUT_MS,
  type ProbeResult,
  type ProviderStatus,
  type ReadOptions,
  type SwarmProvider,
  type UrlUse,
} from '../../provider';
import { socBodyOf, type WrappedChunk, wrappedChunkOf } from '../../singleOwnerChunk';
import {
  FREEDOM_BUDGET_WINDOW_MS,
  type FreedomSwarm,
  freedomErrorOf,
  INVALID_PARAMS,
  NODE_UNAVAILABLE,
} from './freedomSwarm';

/**
 * Every read through Freedom first asks its node whether it is up, which Freedom gives 5 s, and a stream list's head
 * took Ant 6.5 s cold against 0.8 s warm. A slot not written yet answers in 1.6 to 2.1 s, against 0.35 s on a gateway.
 * 15 s holds the slowest of those with room, and stays well inside the 60 s Freedom's own shim waits.
 */
const FREEDOM_READ_WINDOW_MS = 15_000;

/** What Freedom's shim rejects a call with when it had no answer in its own window. */
const SHIM_TIMED_OUT = 'Request timed out';
const INTERNAL_ERROR = -32603;
/** How long the shim waits for `swarm_readData`, a blob joined from the network, and for every other read. */
const SHIM_DATA_WINDOW_MS = 300_000;
const SHIM_READ_WINDOW_MS = 60_000;
/** The one call Freedom answers outside the read budget. */
const CAPABILITIES = 'swarm_getCapabilities';
/**
 * How long a refusal past the end of the window the page counted holds reads back. Freedom's window started when the
 * window's first read reached it, a moment after the page sent it, so its end is that moment away.
 */
const LATE_REFUSAL_WAIT_MS = 1_000;

/** The `data.reason` of a read Freedom answers as content that is not there. */
const NOT_THERE: ReadonlySet<string> = new Set(['feed_empty', 'entry_not_found', 'chunk_not_found']);
/** The read refused for being over the site's budget, which a connected site has more of. */
const RATE_LIMITED = 'rate_limited';
/** A blob larger than the whole byte budget of a window, refused before it is downloaded. */
const DATA_TOO_LARGE = 'data_too_large';
/** The bytes at a chunk's address are not a content-addressed chunk, such as a single-owner chunk read as one. */
const CHUNK_TYPE_MISMATCH = 'chunk_type_mismatch';

const IDENTIFIER_LENGTH = 32;
const SIGNATURE_LENGTH = 65;

interface FreedomProviderOptions {
  /** The page's `window.swarm`, injected by tests. Null where the page does not run in Freedom. */
  readonly swarm: FreedomSwarm | null;
  /**
   * Where a read goes while Freedom refuses this site's reads for being over its budget, the deployment's default
   * gateway. Without one, such a read answers rate limited.
   */
  readonly overBudget?: SwarmProvider;
  /** Injected by tests. The viewer's clock otherwise. */
  readonly now?: () => number;
}

/** A call's result, or the answer its failure is, with Freedom's reason for it. */
type Called =
  | { readonly ok: true; readonly result: Record<string, unknown> }
  | { readonly ok: false; readonly answer: SwarmAnswer; readonly code: number | null; readonly reason: string | null };

/** A blob Freedom refused for being larger than this site's whole byte budget, which a gateway serves. */
const OVER_BYTE_BUDGET = { kind: 'over-byte-budget' } as const;

const unavailable = (why: string): SwarmAnswer => ({
  kind: 'unavailable',
  cause: { kind: 'network', error: new Error(`Freedom's Swarm node ${why}`) },
});

function bytesOf(base64: unknown): Uint8Array | null {
  if (typeof base64 !== 'string') {
    return null;
  }
  try {
    const text = atob(base64);
    const bytes = new Uint8Array(text.length);
    for (let at = 0; at < text.length; at += 1) {
      bytes[at] = text.charCodeAt(at);
    }
    return bytes;
  } catch {
    return null;
  }
}

/** A span as Freedom answers it, a number or a BigInt past the safe integers, as the 8 bytes a chunk starts with. */
function spanBytesOf(span: unknown): Uint8Array | null {
  try {
    const value = typeof span === 'bigint' ? span : typeof span === 'number' ? BigInt(span) : null;
    return value === null ? null : Span.fromBigInt(value).toUint8Array();
  } catch {
    return null;
  }
}

/** A chunk's span then its payload, as Bee's `/chunks` serves a content-addressed chunk. */
function chunkOf(span: Uint8Array, payload: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(SPAN_LENGTH + payload.length);
  chunk.set(span);
  chunk.set(payload, SPAN_LENGTH);
  return chunk;
}

const content = (bytes: Uint8Array, feedIndex: number | null = null): SwarmAnswer => ({
  kind: 'content',
  bytes,
  feedIndex,
  serverTimeMs: null,
});

/** A call that ended without Freedom's word on it: stopped, timed out here, or with no Freedom to ask. */
const refusal = (answer: SwarmAnswer): Called => ({ ok: false, answer, code: null, reason: null });

/** What a rejected call is as an answer, following the errors of Freedom's provider API. */
function failureOf(error: unknown, method: string, windowMs: number): Called {
  const { code, message, data } = freedomErrorOf(error);
  const reason = typeof data?.reason === 'string' ? data.reason : null;
  const failed = (answer: SwarmAnswer): Called => ({
    ok: false,
    answer,
    code: typeof code === 'number' ? code : null,
    reason,
  });
  if (code === INVALID_PARAMS) {
    if (reason !== null && NOT_THERE.has(reason)) {
      return failed({ kind: 'not-found', serverTimeMs: null });
    }
    if (reason === RATE_LIMITED) {
      // The window's length, which the provider turns into what is left of it.
      const windowMs =
        typeof data?.windowMs === 'number' && data.windowMs >= 0 ? data.windowMs : FREEDOM_BUDGET_WINDOW_MS;
      return failed({ kind: 'rate-limited', retryAfterMs: windowMs, serverTimeMs: null });
    }
    // Every other reason is a request Freedom will refuse however often it is asked, a blob larger than the site's
    // whole byte budget among them.
    return failed(UNSUPPORTED);
  }
  if (code === NODE_UNAVAILABLE) {
    return failed(
      unavailable(reason === null ? "is switched off in Freedom's settings" : `is not available (${reason})`),
    );
  }
  if (code === INTERNAL_ERROR && message === SHIM_TIMED_OUT) {
    const shimWindowMs = method === 'swarm_readData' ? SHIM_DATA_WINDOW_MS : SHIM_READ_WINDOW_MS;
    return failed({ kind: 'unavailable', cause: { kind: 'timeout', timeoutMs: Math.min(windowMs, shimWindowMs) } });
  }
  if (code === INTERNAL_ERROR) {
    return failed({ kind: 'unavailable', cause: { kind: 'network', error } });
  }
  // An unknown method, from a Freedom older than the reads this provider makes, and a grant a public read never needs.
  if (typeof code === 'number' && code >= 4000 && code < 5000) {
    return failed(UNSUPPORTED);
  }
  return failed({ kind: 'unavailable', cause: { kind: 'network', error } });
}

/**
 * Freedom's read budget for this site as the page sees it. Freedom counts it over a fixed window that starts at the
 * window's first read, and a refusal names only the window's length, so the page keeps when its own window started to
 * know when Freedom's ends. One per `window.swarm`, shared by the provider of every part, since Freedom counts all of
 * this site's reads together and one refusal means every other part's next read is refused too.
 */
class FreedomBudget {
  private windowMs = FREEDOM_BUDGET_WINDOW_MS;
  private windowStartedAtMs: number | null = null;
  /**
   * The reads sent in the page's window, from its first. A late refusal of its first says it reached Freedom in its
   * last window and started none there, so the page's window starts at the next of them instead, however long after.
   */
  private sentInWindowAtMs: number[] = [];
  /** Whether the page has counted a window before, whose end in Freedom is then a moment after the page's. */
  private countedWindow = false;
  /** Whether the page's window followed one it counted. */
  private followsWindow = false;
  private overUntilMs = 0;

  isOver(nowMs: number): boolean {
    return nowMs < this.overUntilMs;
  }

  /** A read sent to Freedom, the first of a new window where the last one has ended. */
  sent(nowMs: number): void {
    if (this.windowStartedAtMs === null || nowMs - this.windowStartedAtMs >= this.windowMs) {
      this.followsWindow = this.countedWindow;
      this.countedWindow = true;
      this.windowStartedAtMs = nowMs;
      this.sentInWindowAtMs = [];
    }
    this.sentInWindowAtMs.push(nowMs);
  }

  /**
   * A read sent at `sentAtMs` that Freedom refused for the budget of a window `windowMs` long. Answers how long it
   * refuses reads still. A read sent in the first moment of a window that followed one the page counted may have
   * reached Freedom while Freedom's last window, which started that moment later, was still open, so its refusal is a
   * late one too.
   */
  refused(sentAtMs: number, nowMs: number, windowMs: number): number {
    this.windowMs = windowMs;
    const startedAtMs = this.windowStartedAtMs ?? sentAtMs;
    const endsAtMs = startedAtMs + windowMs;
    const late = endsAtMs <= nowMs || (this.followsWindow && sentAtMs - startedAtMs < LATE_REFUSAL_WAIT_MS);
    if (late) {
      this.notStartedBy(sentAtMs);
    }
    this.overUntilMs = late ? nowMs + Math.min(LATE_REFUSAL_WAIT_MS, windowMs) : endsAtMs;
    return this.overUntilMs - nowMs;
  }

  /**
   * A read refused late started no window in Freedom. Were the page's window counted from it, the page's would run
   * ahead of Freedom's by as long as Freedom took to accept a read again, past the moment a late refusal is judged by.
   */
  private notStartedBy(sentAtMs: number): void {
    const at = this.sentInWindowAtMs.indexOf(sentAtMs);
    if (at === -1) {
      return;
    }
    this.sentInWindowAtMs.splice(at, 1);
    if (this.windowStartedAtMs === sentAtMs) {
      this.windowStartedAtMs = this.sentInWindowAtMs[0] ?? null;
    }
  }
}

const budgets = new WeakMap<FreedomSwarm, FreedomBudget>();

function budgetOf(swarm: FreedomSwarm | null): FreedomBudget {
  if (swarm === null) {
    return new FreedomBudget();
  }
  let budget = budgets.get(swarm);
  if (budget === undefined) {
    budget = new FreedomBudget();
    budgets.set(swarm, budget);
  }
  return budget;
}

/**
 * Swarm read through the node of the Freedom browser the page runs in, over its `window.swarm`, the only way a page
 * reaches that node. Freedom checks what it serves against the address it was asked for, joins a body longer than one
 * chunk, and answers a feed's head from its own lookup.
 *
 * The video, previews and pictures load as `bzz://` URLs, which Freedom serves from the same node with no budget. The
 * reads here are counted against Freedom's budget for this site, a fixed minute of 120 reads, 600 once the viewer
 * connected the site. Once a read is refused for it every read is refused until the minute ends, so until then every
 * read of every part goes to {@link FreedomProviderOptions.overBudget}, the event gateway, rather than waiting.
 *
 * A read cannot be cancelled in Freedom, so a read the caller stopped answers aborted at once and its late result is
 * dropped.
 */
export class FreedomProvider implements SwarmProvider {
  readonly shortestReadWindowMs = FREEDOM_READ_WINDOW_MS;

  private readonly swarm: FreedomSwarm | null;
  private readonly overBudget: SwarmProvider | null;
  private readonly now: () => number;
  private readonly budget: FreedomBudget;

  constructor(options: FreedomProviderOptions) {
    this.swarm = options.swarm;
    this.overBudget = options.overBudget ?? null;
    this.now = options.now ?? (() => Date.now());
    this.budget = budgetOf(this.swarm);
  }

  /** Freedom's own lookup of the newest entry, which names its index. */
  readFeedHead(owner: string, topic: Topic, options?: ReadOptions): Promise<SwarmAnswer> {
    return this.budgeted(
      (provider) => provider.readFeedHead(owner, topic, options),
      () => this.readFeed({ topic: topic.toHex(), owner }, options),
    );
  }

  /** An entry by its index, its body joined by Freedom where it is longer than one chunk. */
  async readFeedEntry(owner: string, topic: Topic, index: number, options?: ReadOptions): Promise<SwarmAnswer> {
    if (!Number.isSafeInteger(index) || index < 0) {
      return UNSUPPORTED;
    }
    return this.budgeted(
      (provider) => provider.readFeedEntry(owner, topic, index, options),
      () => this.readFeed({ topic: topic.toHex(), owner, index }, options),
    );
  }

  /**
   * Freedom checks the owner's signature and answers the payload with its span. A span past one chunk names a tree,
   * whose payload is the root's, so the body is read whole at the wrapped chunk's address, as Bee's `/soc` joins it.
   */
  readSoc(owner: string, identifier: string, options?: ReadOptions): Promise<SwarmAnswer> {
    return this.budgeted(
      (provider) => provider.readSoc(owner, identifier, options),
      async () => {
        const called = await this.call('swarm_readSingleOwnerChunk', { owner, identifier }, options);
        if (!called.ok) {
          return called.answer;
        }
        const span = spanBytesOf(called.result.span);
        const payload = bytesOf(called.result.data);
        if (span === null || payload === null) {
          return unavailable('answered a single-owner chunk it did not spell out');
        }
        let chunk: WrappedChunk;
        try {
          chunk = wrappedChunkOf(chunkOf(span, payload));
        } catch {
          return unavailable('answered a single-owner chunk longer than one chunk');
        }
        return socBodyOf(
          chunk,
          { kind: 'content', bytes: payload, feedIndex: null, serverTimeMs: null },
          (root) => this.readBytes(root, options),
          unavailable,
        );
      },
    );
  }

  /**
   * A content-addressed chunk as its span and payload, which is what Bee's `/chunks` serves. A single-owner chunk at
   * that address, which Freedom refuses as a content-addressed one, is read as one and given back whole, identifier,
   * signature, span and payload, so a caller that checks it is the owner's, as the chat does, reads it as from Bee.
   */
  readChunk(address: string, options?: ReadOptions): Promise<SwarmAnswer> {
    return this.budgeted(
      (provider) => provider.readChunk(address, options),
      async () => {
        const called = await this.call('swarm_readChunk', { reference: address }, options);
        if (!called.ok) {
          return called.reason === CHUNK_TYPE_MISMATCH ? this.readSocByAddress(address, options) : called.answer;
        }
        const span = spanBytesOf(called.result.span);
        const payload = bytesOf(called.result.data);
        return span === null || payload === null
          ? unavailable('answered a chunk it did not spell out')
          : content(chunkOf(span, payload));
      },
    );
  }

  readBytes(reference: string, options?: ReadOptions): Promise<SwarmAnswer> {
    return this.budgeted(
      (provider) => provider.readBytes(reference, options),
      async () => {
        const called = await this.call('swarm_readData', { reference }, options);
        if (!called.ok) {
          return called.reason === DATA_TOO_LARGE ? OVER_BYTE_BUDGET : called.answer;
        }
        const bytes = bytesOf(called.result.data);
        return bytes === null ? unavailable('answered bytes it did not spell out') : content(bytes);
      },
    );
  }

  /**
   * Every URL is Freedom's own `bzz:` scheme, which its node serves to `fetch` and to the page with no read budget: a
   * segment's raw bytes and a picture's one-file upload alike resolve at `bzz://<reference>/`. Encoded because a
   * reference comes from the stream list, external input.
   */
  urlFor(reference: string, _use: UrlUse): string | null {
    return `bzz://${encodeURIComponent(reference.trim())}/`;
  }

  /** Freedom runs its node itself, so there is nothing to start: it is there wherever the page runs in Freedom. */
  status(): ProviderStatus {
    return { state: this.swarm === null ? 'failed' : 'ready' };
  }

  /**
   * Asks `swarm_getCapabilities`, which Freedom answers with no prompt and outside the read budget. It says whether
   * the node runs only to a site the viewer connected, so for any other site the node's own state is first known from
   * a read.
   */
  async probe(options: ReadOptions = {}): Promise<ProbeResult> {
    if (this.swarm === null) {
      return { kind: 'unreachable' };
    }
    const startedAtMs = this.now();
    const called = await this.call(CAPABILITIES, {}, { ...options, timeoutMs: options.timeoutMs ?? PROBE_TIMEOUT_MS });
    if (called.ok) {
      return called.result.reason === 'node-stopped'
        ? { kind: 'not-ready', reason: { kind: 'node-stopped' } }
        : { kind: 'ok', elapsedMs: this.now() - startedAtMs };
    }
    if (called.code === NODE_UNAVAILABLE) {
      return { kind: 'not-ready', reason: { kind: called.reason === null ? 'switched-off' : 'node-stopped' } };
    }
    if (called.answer.kind === 'unavailable' && called.answer.cause.kind === 'timeout') {
      return { kind: 'timed-out' };
    }
    // Unreachable is kept for a page with no `window.swarm`, which the checks report as not open in Freedom. Stopped,
    // the probe answered nothing. Rejected carries an error code Freedom sent; an answer of no shape, or a failure
    // with no code of Freedom's provider API, is not Freedom's node answering as it does.
    if (called.answer.kind === 'aborted') {
      return { kind: 'unreachable' };
    }
    return called.code === null ? { kind: 'not-swarm' } : { kind: 'rejected', status: called.code };
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  private async readFeed(params: Record<string, unknown>, options?: ReadOptions): Promise<SwarmAnswer> {
    const called = await this.call('swarm_readFeedEntry', params, options);
    if (!called.ok) {
      return called.answer;
    }
    const bytes = bytesOf(called.result.data);
    const { index } = called.result;
    return bytes === null
      ? unavailable('answered a feed entry it did not spell out')
      : content(bytes, typeof index === 'number' && Number.isSafeInteger(index) ? index : null);
  }

  private async readSocByAddress(address: string, options?: ReadOptions): Promise<SwarmAnswer> {
    const called = await this.call('swarm_readSingleOwnerChunk', { address }, options);
    if (!called.ok) {
      return called.answer;
    }
    const { identifier, signature, span, data } = called.result;
    const parts = [
      hexBytesOf(identifier, IDENTIFIER_LENGTH),
      hexBytesOf(signature, SIGNATURE_LENGTH),
      spanBytesOf(span),
      bytesOf(data),
    ];
    if (parts.some((part) => part === null)) {
      return unavailable('answered a single-owner chunk it did not spell out');
    }
    return content(concatenated(parts as Uint8Array[]));
  }

  /**
   * A read through Freedom, or through the gateway while Freedom refuses this site's reads. A read Freedom refuses for
   * the budget starts that wait, and goes to the gateway itself.
   */
  private async budgeted(
    elsewhere: (provider: SwarmProvider) => Promise<SwarmAnswer>,
    here: () => Promise<SwarmAnswer | typeof OVER_BYTE_BUDGET>,
  ): Promise<SwarmAnswer> {
    const { overBudget } = this;
    if (overBudget !== null && this.budget.isOver(this.now())) {
      return elsewhere(overBudget);
    }
    const answer = await here();
    if (answer.kind === OVER_BYTE_BUDGET.kind) {
      return overBudget === null ? UNSUPPORTED : elsewhere(overBudget);
    }
    if (answer.kind === 'rate-limited' && overBudget !== null && this.budget.isOver(this.now())) {
      return elsewhere(overBudget);
    }
    return answer;
  }

  /** One call of `window.swarm`, inside the read's window, never rejecting. */
  private call(method: string, params: Record<string, unknown>, options: ReadOptions = {}): Promise<Called> {
    const { swarm } = this;
    const { signal } = options;
    const timeoutMs = options.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
    if (signal?.aborted) {
      return Promise.resolve(refusal(ABORTED));
    }
    if (swarm === null) {
      return Promise.resolve(refusal(unavailable('is not here: this page is not open in Freedom')));
    }
    const sentAtMs = this.now();
    if (method !== CAPABILITIES) {
      this.budget.sent(sentAtMs);
    }
    return new Promise<Called>((resolve) => {
      let settled = false;
      const settle = (called: Called) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
        resolve(called);
      };
      const stop = () => settle(refusal(ABORTED));
      const timer = setTimeout(
        () => settle(refusal({ kind: 'unavailable', cause: { kind: 'timeout', timeoutMs } })),
        timeoutMs,
      );
      signal?.addEventListener('abort', stop, { once: true });
      let asked: Promise<unknown>;
      try {
        asked = swarm.request({ method, params });
      } catch (error) {
        asked = Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      asked.then(
        (result) =>
          settle(
            typeof result === 'object' && result !== null
              ? { ok: true, result: result as Record<string, unknown> }
              : refusal(unavailable(`answered ${method} with nothing`)),
          ),
        (error: unknown) => settle(this.failed(error, method, timeoutMs, sentAtMs)),
      );
    });
  }

  /** A rejected call as its answer. A refusal for the budget waits only what is left of Freedom's window. */
  private failed(error: unknown, method: string, timeoutMs: number, sentAtMs: number): Called {
    const failed = failureOf(error, method, timeoutMs);
    if (failed.ok || failed.answer.kind !== 'rate-limited') {
      return failed;
    }
    const waitMs = this.budget.refused(sentAtMs, this.now(), failed.answer.retryAfterMs ?? FREEDOM_BUDGET_WINDOW_MS);
    return { ...failed, answer: { ...failed.answer, retryAfterMs: Math.min(waitMs, LONGEST_RETRY_AFTER_MS) } };
  }
}

function concatenated(parts: readonly Uint8Array[]): Uint8Array {
  const whole = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let at = 0;
  for (const part of parts) {
    whole.set(part, at);
    at += part.length;
  }
  return whole;
}

function hexBytesOf(hex: unknown, length: number): Uint8Array | null {
  if (typeof hex !== 'string') {
    return null;
  }
  const digits = hex.replace(/^0x/i, '');
  if (!new RegExp(`^[0-9a-f]{${length * 2}}$`, 'i').test(digits)) {
    return null;
  }
  return new Bytes(digits).toUint8Array();
}
