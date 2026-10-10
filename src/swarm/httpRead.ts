/**
 * One read over HTTP, sorted into a {@link SwarmAnswer} the way Bee's API answers: a status the caller
 * names is content that is not there, 429 is the server asking to be left alone, and any other status
 * that is not a success is a fault. Shared by every provider that reaches Swarm through a URL.
 */
import { resolvedFeedIndex } from '@/shared/feedFollow';

import { ABORTED, type SwarmAnswer } from './answers';
import { boundedRequest } from './boundedRequest';
import { DEFAULT_READ_TIMEOUT_MS, type ReadOptions } from './provider';

/** The longest a server's `Retry-After` may keep a provider paused, so one answer cannot stall a feed for an hour. */
export const LONGEST_RETRY_AFTER_MS = 60_000;

const NOT_FOUND = 404;
const TOO_MANY_REQUESTS = 429;

/** The statuses a read takes as content that is not there. */
export type AbsentStatuses = ReadonlySet<number>;

export const ABSENT: AbsentStatuses = new Set([NOT_FOUND]);

export const isSuccess = (status: number) => status >= 200 && status < 300;

function dateOf(headers: Headers): number | null {
  const date = headers.get('date');
  const ms = date === null ? Number.NaN : Date.parse(date);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The wait `Retry-After` asks for, as seconds or as an HTTP date, never longer than
 * {@link LONGEST_RETRY_AFTER_MS}. A date is read against the answer's own `Date` when it has one,
 * because the two come from the same clock and the viewer's may be off. A value that is negative or
 * too large to be a number is read as no wait named.
 */
function retryAfterMsOf(headers: Headers, serverTimeMs: number | null): number | null {
  const raw = headers.get('retry-after')?.trim();
  if (!raw) {
    return null;
  }
  if (/^-?\d+$/.test(raw)) {
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds >= 0 ? cappedRetryAfterMs(seconds * 1000) : null;
  }
  const until = Date.parse(raw);
  return Number.isFinite(until) ? cappedRetryAfterMs(Math.max(0, until - (serverTimeMs ?? Date.now()))) : null;
}

function cappedRetryAfterMs(ms: number): number {
  return Math.min(ms, LONGEST_RETRY_AFTER_MS);
}

function answerOf(response: Response, body: Uint8Array | null, absent: AbsentStatuses): SwarmAnswer {
  const serverTimeMs = dateOf(response.headers);
  if (absent.has(response.status)) {
    return { kind: 'not-found', serverTimeMs };
  }
  if (response.status === TOO_MANY_REQUESTS) {
    return { kind: 'rate-limited', retryAfterMs: retryAfterMsOf(response.headers, serverTimeMs), serverTimeMs };
  }
  if (body === null) {
    return { kind: 'unavailable', cause: { kind: 'status', status: response.status } };
  }
  return { kind: 'content', bytes: body, feedIndex: resolvedFeedIndex(response.headers), serverTimeMs };
}

interface HttpReadOptions extends ReadOptions {
  readonly fetcher: typeof fetch;
  readonly absent?: AbsentStatuses;
}

/** A GET of `url` inside the read's window, as an answer. Never rejects. */
export async function httpRead(url: string, options: HttpReadOptions): Promise<SwarmAnswer> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  const outcome = await boundedRequest(url, {
    fetcher: options.fetcher,
    timeoutMs,
    signal: options.signal,
    readsBody: isSuccess,
  });
  switch (outcome.kind) {
    case 'aborted':
      return ABORTED;
    case 'timed-out':
      return { kind: 'unavailable', cause: { kind: 'timeout', timeoutMs } };
    case 'failed':
      return { kind: 'unavailable', cause: { kind: 'network', error: outcome.error } };
    case 'response':
      return answerOf(outcome.response, outcome.body, options.absent ?? ABSENT);
  }
}
