/**
 * The checks a source passes before it is added, and again from its settings: one line each, run in the order
 * of its kind, each timed, and the first that fails stops the rest. Every read goes through a Swarm client made
 * for that source alone, so a pass and a failure are the source's own. Pure apart from that client, which a test
 * hands in.
 */
import { Topic } from '@ethersphere/bee-js';

import type { Stream } from '@/features/catalog/stream';
import { supportsLocalNetworkRequests } from '@/swarm/addressSpace';
import { contentText, type SwarmAnswer } from '@/swarm/answers';
import type { SwarmClient } from '@/swarm/client';
import { DEFAULT_READ_TIMEOUT_MS, PROBE_TIMEOUT_MS, type ReadOptions } from '@/swarm/provider';
import type { SourceType } from '@/swarm/sources';

import {
  CHECK_STEPS,
  type CheckFailure,
  type CheckStep,
  corsRefused,
  healthRefused,
  LOCAL_NETWORK_BLOCKED,
  MIXED_CONTENT_BLOCKED,
  NODE_FAILED,
  noAnswerFor,
  NOT_BEE,
  NOT_HTTPS,
  NOT_THE_STREAM_LIST,
  NOTHING_ANSWERS,
  NOTHING_TO_READ,
  notReady,
  readFailure,
  tooFewPeers,
  VERSION_NOT_STATED,
  WEEB3_CHECK_PEERS,
} from './checkWords';
import { firstSegmentOf, playlistOf, streamListIn, streamToTest } from './eventContent';
import { checkOwnNodeAddress, isBlockedAsMixedContent } from './gatewayProbe';
import { awaitsLocalNetworkAnswer, type ReachabilityOptions, unreachableCause } from './reachability';

/** What a source to check is: its kind and its address, empty for the node in this browser. */
export interface CheckTarget {
  readonly type: SourceType;
  readonly url: string;
}

/** What the checks read through: a client whose every part reads from the source under test. */
type CheckClient = Pick<SwarmClient, 'reader' | 'probe' | 'status'>;

export interface SourceCheckContext {
  readonly client: CheckClient;
  /** The stream list feed this event publishes. */
  readonly catalog: { readonly owner: string; readonly topic: string };
  /**
   * The streams the page already shows, read from whichever source the stream list reads from. The chunk and
   * the bytes are read from these, so a source that cannot read the list itself is still told what else it reads.
   */
  readonly knownStreams: readonly Stream[];
  readonly signal?: AbortSignal;
  /** What to add to the viewer's clock to read the gateway's, for a ladder's time marker. */
  readonly clockOffsetMs?: number;
  /** Injected by tests. The viewer's clock otherwise. */
  readonly now?: () => number;
  /** Injected by tests. A real wait otherwise. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** The origin the page is served from, which an address on this site is resolved against. Read from the page when absent. */
  readonly pageOrigin?: string;
  /** Injected by tests. Read from the page otherwise. */
  readonly pageProtocol?: string;
  /** Whether this browser can mark a request as meant for the local network. Asked of the browser when absent. */
  readonly localNetworkRequests?: boolean;
  /** Injected by tests. Reads the page and asks the browser's Permissions API otherwise. */
  readonly reachability?: ReachabilityOptions;
}

export type StepState =
  | { readonly step: CheckStep; readonly state: 'waiting' }
  | { readonly step: CheckStep; readonly state: 'running' }
  /** `note` is what the line says in place of its time, where the check passed without measuring all of it. */
  | { readonly step: CheckStep; readonly state: 'passed'; readonly ms: number; readonly note?: string }
  | { readonly step: CheckStep; readonly state: 'failed'; readonly ms: number; readonly failure: CheckFailure }
  /** Not run, because a check before it failed. */
  | { readonly step: CheckStep; readonly state: 'skipped' };

/** Whether every check passed, which is the only time a source may be added. */
export function checksPassed(results: readonly StepState[]): boolean {
  return results.length > 0 && results.every(({ state }) => state === 'passed');
}

/** The first failure among the results, which is what the warning under the list says. */
export function firstFailure(results: readonly StepState[]): CheckFailure | null {
  for (const result of results) {
    if (result.state === 'failed') {
      return result.failure;
    }
  }
  return null;
}

/** How long the node in this browser may take to download and start, its own two deadlines together. */
const WEEB3_START_WAIT_MS = 90_000;
/** How long it may take to reach the peers the checks wait for, once started. */
const WEEB3_PEERS_WAIT_MS = 60_000;
/** How often the node's state is read while the checks wait on it. */
const WEEB3_POLL_MS = 500;

type Outcome = { readonly ok: true; readonly note?: string } | { readonly ok: false; readonly failure: CheckFailure };

const pass = (note?: string): Outcome => (note === undefined ? { ok: true } : { ok: true, note });
const fail = (failure: CheckFailure): Outcome => ({ ok: false, failure });

const STOPPED: CheckFailure = readFailure('it', { kind: 'aborted' });

/**
 * Runs the checks of the target's kind in order and answers one state per check. `onProgress` is told every
 * change, a check starting and a check ending, so a list can fill in line by line. Never rejects.
 */
export async function runSourceChecks(
  target: CheckTarget,
  context: SourceCheckContext,
  onProgress?: (results: readonly StepState[]) => void,
): Promise<StepState[]> {
  const run = new CheckRun(target, context);
  const now = context.now ?? (() => Date.now());
  const results: StepState[] = CHECK_STEPS[target.type].map((step) => ({ step, state: 'waiting' }));
  const tell = () => onProgress?.([...results]);
  for (let at = 0; at < results.length; at += 1) {
    const { step } = results[at];
    results[at] = { step, state: 'running' };
    tell();
    const startedAtMs = now();
    const outcome = context.signal?.aborted ? fail(STOPPED) : await run.step(step);
    const ms = Math.max(0, Math.round(now() - startedAtMs));
    if (outcome.ok) {
      results[at] = { step, state: 'passed', ms, ...(outcome.note === undefined ? {} : { note: outcome.note }) };
      continue;
    }
    results[at] = { step, state: 'failed', ms, failure: outcome.failure };
    for (let later = at + 1; later < results.length; later += 1) {
      results[later] = { step: results[later].step, state: 'skipped' };
    }
    break;
  }
  tell();
  return results;
}

function currentPageOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

function currentPageProtocol(): string {
  return typeof window === 'undefined' ? '' : window.location.protocol;
}

const THIS_COMPUTER = ['localhost', '127.0.0.1'];

/** An address as the browser reaches it, a path on this site resolved against the page. */
function reachedAt(url: string, origin: string): URL | null {
  try {
    return new URL(url, origin || undefined);
  } catch {
    return null;
  }
}

/** One run of the checks, which remembers what one check found for the ones after it. */
class CheckRun {
  private readonly window: ReadOptions;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  /** Whether the first answer could be read by this page, which the CORS check reports. */
  private isReadable = false;
  private reference: Promise<string | CheckFailure> | null = null;

  constructor(
    private readonly target: CheckTarget,
    private readonly context: SourceCheckContext,
  ) {
    this.window = { timeoutMs: DEFAULT_READ_TIMEOUT_MS, signal: context.signal };
    this.sleep = context.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = context.now ?? (() => Date.now());
  }

  step(step: CheckStep): Promise<Outcome> {
    switch (step) {
      case 'https':
      case 'reach':
        return this.answers();
      case 'cors':
        return Promise.resolve(this.isReadable ? pass() : fail(corsRefused(this.target.type, this.origin())));
      case 'version':
        return this.version();
      case 'chunk':
        return this.readsReference('chunk');
      case 'bytes':
        return this.readsReference('bytes');
      case 'feed':
        return this.readsStreamList();
      case 'start':
        return this.nodeStarted();
      case 'peers':
        return this.nodeHasPeers();
    }
  }

  private origin(): string {
    return this.context.pageOrigin ?? currentPageOrigin();
  }

  /** Why the page will not reach the address at all, or null when it will. */
  private addressRefusal(): CheckFailure | null {
    const { type, url } = this.target;
    if (type === 'bee-node') {
      const allowed = checkOwnNodeAddress(url);
      if (!allowed.ok) {
        return {
          reason: 'This site reaches a Bee node only on this computer or at an https address.',
          fix: allowed.text,
        };
      }
    } else {
      const reached = reachedAt(url, this.origin());
      if (reached === null || (reached.protocol !== 'https:' && !THIS_COMPUTER.includes(reached.hostname))) {
        return NOT_HTTPS;
      }
    }
    return null;
  }

  /**
   * Whether something answers at the address, read with the stream list's first entry, the one read every
   * source serving this event admits. A browser reports a refusal of this site the same as nothing there, so a
   * read that got nothing readable asks the provider's probe, which tells the two apart.
   */
  private async answers(): Promise<Outcome> {
    const refusal = this.addressRefusal();
    if (refusal !== null) {
      return fail(refusal);
    }
    const address = reachedAt(this.target.url, this.origin())?.href ?? this.target.url;
    const localNetworkRequests = this.context.localNetworkRequests ?? (await supportsLocalNetworkRequests());
    if (isBlockedAsMixedContent(address, this.context.pageProtocol ?? currentPageProtocol(), localNetworkRequests)) {
      return fail(MIXED_CONTENT_BLOCKED);
    }
    const { owner, topic } = this.context.catalog;
    const answer = await this.context.client
      .reader('stream-list')
      .readFeedEntry(owner, Topic.fromString(topic), 0, this.window);
    if (answer.kind === 'aborted') {
      return fail(STOPPED);
    }
    if (answer.kind !== 'unavailable' || answer.cause.kind === 'status') {
      this.isReadable = true;
      return pass();
    }
    if (answer.cause.kind === 'timeout') {
      return fail(noAnswerFor(answer.cause.timeoutMs));
    }
    const reachability = { localNetworkRequests, ...this.context.reachability };
    const found = await this.context.client.probe({ timeoutMs: PROBE_TIMEOUT_MS, signal: this.context.signal });
    switch (found.kind) {
      case 'unreachable': {
        const cause = await unreachableCause(address, found, reachability);
        return fail(cause.kind === 'unreachable' ? NOTHING_ANSWERS : LOCAL_NETWORK_BLOCKED);
      }
      case 'timed-out':
        return fail(
          (await awaitsLocalNetworkAnswer(address, reachability))
            ? LOCAL_NETWORK_BLOCKED
            : noAnswerFor(PROBE_TIMEOUT_MS),
        );
      default:
        // Something answered, and the read this page needs could not be read, which is a refusal of this site.
        return pass();
    }
  }

  /**
   * The Bee release, from the node's own health. A gateway may keep its node's health to itself, so one that
   * does not say passes with a note, and only one that names an older release fails. A Bee node of the viewer's
   * own must also be ready to serve.
   */
  private async version(): Promise<Outcome> {
    const found = await this.context.client.probe({ timeoutMs: PROBE_TIMEOUT_MS, signal: this.context.signal });
    if (this.target.type === 'gateway') {
      if (found.kind === 'not-ready' && found.reason.kind === 'too-old') {
        return fail(notReady(found.reason));
      }
      return found.kind === 'ok' && found.version !== undefined ? pass() : pass(VERSION_NOT_STATED);
    }
    switch (found.kind) {
      case 'ok':
        return pass();
      case 'not-ready':
        return fail(notReady(found.reason));
      case 'not-swarm':
        return fail(NOT_BEE);
      case 'rejected':
        return fail(healthRefused(found.status));
      case 'timed-out':
        return fail(noAnswerFor(PROBE_TIMEOUT_MS));
      case 'refuses-this-site':
        return fail(corsRefused(this.target.type, this.origin()));
      case 'unreachable':
        return fail(NOTHING_ANSWERS);
    }
  }

  /**
   * A chunk read the way the chat history reads its slots, through the source's chat route, and bytes the way the
   * player reads a segment, both of one reference from this event's content.
   */
  private async readsReference(read: 'chunk' | 'bytes'): Promise<Outcome> {
    const reference = await this.referenceToRead();
    if (typeof reference !== 'string') {
      return fail(reference);
    }
    const answer =
      read === 'chunk'
        ? await this.context.client.reader('chat').readChunk(reference, this.window)
        : await this.context.client.reader('player').readBytes(reference, this.window);
    return answer.kind === 'content' ? pass() : fail(readFailure(read === 'chunk' ? 'a chunk' : 'bytes', answer));
  }

  /** A reference this event's content names: a segment of the stream the checks use, else a stream's picture. */
  private referenceToRead(): Promise<string | CheckFailure> {
    this.reference ??= this.findReference();
    return this.reference;
  }

  private async findReference(): Promise<string | CheckFailure> {
    const streams = this.context.knownStreams.length > 0 ? this.context.knownStreams : await this.readStreams();
    if ('reason' in streams) {
      return streams;
    }
    const stream = streamToTest(streams);
    let failure: CheckFailure = NOTHING_TO_READ;
    if (stream !== null) {
      const playlist = await playlistOf(
        {
          reader: this.context.client.reader('player'),
          window: this.window,
          clockOffsetMs: this.context.clockOffsetMs ?? 0,
          now: this.now,
        },
        stream,
      );
      const segment = playlist.kind === 'served' ? firstSegmentOf(playlist.text) : null;
      if (segment !== null) {
        return segment;
      }
      if (playlist.kind === 'failed' && playlist.answer !== null) {
        failure = readFailure('a playlist of the video', playlist.answer);
      }
    }
    return streams.find((candidate) => candidate.thumbnail?.trim())?.thumbnail?.trim() ?? failure;
  }

  /** The node in this browser finds a head only by a search that costs a few 17 s misses, so its list is read by its first entry. */
  private readStreamListAnswer(): Promise<SwarmAnswer> {
    const { owner, topic } = this.context.catalog;
    const reader = this.context.client.reader('stream-list');
    return this.target.type === 'weeb-3'
      ? reader.readFeedEntry(owner, Topic.fromString(topic), 0, this.window)
      : reader.readFeedHead(owner, Topic.fromString(topic), this.window);
  }

  /** The streams this source's stream list names, or why it could not be read. */
  private async readStreams(): Promise<readonly Stream[] | CheckFailure> {
    const answer = await this.readStreamListAnswer();
    if (answer.kind !== 'content') {
      return readFailure("this event's stream list", answer);
    }
    return streamListIn(contentText(answer)) ?? NOT_THE_STREAM_LIST;
  }

  private async readsStreamList(): Promise<Outcome> {
    const answer = await this.readStreamListAnswer();
    if (answer.kind !== 'content') {
      return fail(readFailure("this event's stream list", answer));
    }
    return streamListIn(contentText(answer)) === null ? fail(NOT_THE_STREAM_LIST) : pass();
  }

  /** Started once its module is in and it runs, which is before it has peers. */
  private async nodeStarted(): Promise<Outcome> {
    const until = this.now() + WEEB3_START_WAIT_MS;
    for (;;) {
      const { state, download } = this.context.client.status();
      if (state === 'ready' || (state === 'starting' && download === undefined)) {
        return pass();
      }
      if (state === 'failed' || state === 'lost' || this.now() >= until) {
        return fail(NODE_FAILED);
      }
      if (this.context.signal?.aborted) {
        return fail(STOPPED);
      }
      await this.sleep(WEEB3_POLL_MS);
    }
  }

  private async nodeHasPeers(): Promise<Outcome> {
    const startedAtMs = this.now();
    for (;;) {
      const { state, peers = 0 } = this.context.client.status();
      if (peers >= WEEB3_CHECK_PEERS) {
        return pass();
      }
      if (state === 'failed' || state === 'lost') {
        return fail(NODE_FAILED);
      }
      const waitedMs = this.now() - startedAtMs;
      if (waitedMs >= WEEB3_PEERS_WAIT_MS) {
        return fail(tooFewPeers(peers, waitedMs));
      }
      if (this.context.signal?.aborted) {
        return fail(STOPPED);
      }
      await this.sleep(WEEB3_POLL_MS);
    }
  }
}
