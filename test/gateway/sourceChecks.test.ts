import { describe, expect, it } from 'vitest';

import type { Stream } from '../../src/features/catalog/stream';
import {
  corsRefused,
  NODE_FAILED,
  NOT_HTTPS,
  NOT_THE_STREAM_LIST,
  NOTHING_TO_READ,
  notReady,
  readFailure,
  tooFewPeers,
  VERSION_NOT_STATED,
} from '../../src/features/gateway/checkWords';
import {
  type CheckTarget,
  checksPassed,
  firstFailure,
  runSourceChecks,
  type SourceCheckContext,
  type StepState,
} from '../../src/features/gateway/sourceChecks';
import type { SwarmAnswer } from '../../src/swarm/answers';
import { SwarmClient } from '../../src/swarm/client';
import type { ProbeResult, ProviderStatus, ReadOptions, SwarmProvider } from '../../src/swarm/provider';

const OWNER = '1'.repeat(40);
const CATALOG = { owner: OWNER, topic: 'event-streams' };
const SEGMENT = 'ab'.repeat(32);
const PLAYLIST = `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\n${SEGMENT}\n#EXT-X-ENDLIST\n`;
const STREAM: Stream = {
  owner: 'e'.repeat(40),
  topic: 'main-stage',
  title: 'Main stage',
  timestamp: 1,
  mediatype: 'video',
  state: 'vod',
  renditions: [
    { name: '360p', width: 640, height: 360, topic: 'main-stage-360p', bandwidth: 1, avgBandwidth: 1, index: 2 },
  ],
};
const LIST = JSON.stringify([STREAM]);

const text = (body: string): SwarmAnswer => ({
  kind: 'content',
  bytes: new TextEncoder().encode(body),
  feedIndex: 0,
  serverTimeMs: null,
});
const noAnswer: SwarmAnswer = {
  kind: 'unavailable',
  cause: { kind: 'network', error: new TypeError('Failed to fetch') },
};

type Read = 'feed-head' | 'feed-entry' | 'soc' | 'chunk' | 'bytes';

/** A provider each kind of read of which answers as the test says, logging what it was asked and with which owner. */
class Answering implements SwarmProvider {
  readonly asked: Read[] = [];
  /** Every read of the stream list's feed, in order: `head`, or `entry` and its index. */
  readonly streamListReads: string[] = [];
  answers: Partial<Record<Read, SwarmAnswer>> = {};
  found: ProbeResult = { kind: 'ok', elapsedMs: 3, version: '2.8.2' };
  current: ProviderStatus = { state: 'ready' };

  readFeedHead = async (owner: string, _topic: unknown, options?: ReadOptions) => {
    this.noteStreamListRead(owner, 'head');
    return this.read('feed-head', owner, options);
  };
  readFeedEntry = async (owner: string, _topic: unknown, index: number, options?: ReadOptions) => {
    this.noteStreamListRead(owner, `entry ${index}`);
    return this.read('feed-entry', owner, options);
  };
  readSoc = async (owner: string, _identifier: string, options?: ReadOptions) => this.read('soc', owner, options);
  readChunk = async (_address: string, options?: ReadOptions) => this.read('chunk', '', options);
  readBytes = async (_reference: string, options?: ReadOptions) => this.read('bytes', '', options);
  urlFor = () => null;
  status = () => this.current;
  probe = async () => this.found;
  start = async () => {};
  stop = async () => {};

  private read(read: Read, owner: string, options?: ReadOptions): SwarmAnswer {
    this.asked.push(read);
    if (options?.signal?.aborted) {
      return { kind: 'aborted' };
    }
    const answer = this.answers[read];
    if (answer) {
      return answer;
    }
    // The stream list's own reads name its owner, the stream's playlist reads the stream's.
    return text(owner === OWNER ? LIST : PLAYLIST);
  }

  private noteStreamListRead(owner: string, read: string): void {
    if (owner === OWNER) {
      this.streamListReads.push(read);
    }
  }
}

function world(type: 'gateway' | 'bee-node' | 'weeb-3' = 'gateway', url = 'https://gw.example.com') {
  const source = new Answering();
  const chat = new Answering();
  const client = new SwarmClient({
    chosen: { id: 'tested', provider: source },
    routes: { chat: { id: 'tested', provider: chat } },
  });
  let nowMs = 0;
  const context: SourceCheckContext = {
    client,
    catalog: CATALOG,
    knownStreams: [STREAM],
    pageOrigin: 'https://viewer.example.com',
    pageProtocol: 'https:',
    localNetworkRequests: false,
    now: () => nowMs,
    sleep: async (ms) => {
      nowMs += ms;
    },
  };
  const target: CheckTarget = { type, url };
  return { source, chat, context, target, advance: (ms: number) => (nowMs += ms) };
}

const marks = (results: readonly StepState[]) => results.map(({ step, state }) => [step, state]);

describe('the checks before a gateway is added', () => {
  it('run in the design order and all pass on a gateway that serves this event', async () => {
    const { context, target } = world();
    const results = await runSourceChecks(target, context);

    expect(marks(results)).toEqual([
      ['https', 'passed'],
      ['cors', 'passed'],
      ['version', 'passed'],
      ['chunk', 'passed'],
      ['bytes', 'passed'],
      ['feed', 'passed'],
    ]);
    expect(checksPassed(results)).toBe(true);
    for (const result of results) {
      expect(result.state === 'passed' && typeof result.ms).toBe('number');
    }
  });

  it('tell how they go as each one runs, so the list fills in line by line', async () => {
    const { context, target } = world();
    const seen: string[][] = [];
    await runSourceChecks(target, context, (results) => seen.push(results.map(({ state }) => state)));

    expect(seen[0]).toEqual(['running', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting']);
    expect(seen).toContainEqual(['passed', 'passed', 'running', 'waiting', 'waiting', 'waiting']);
    expect(seen.at(-1)).toEqual(['passed', 'passed', 'passed', 'passed', 'passed', 'passed']);
  });

  it('stop at the first failure, the rest shown as not run', async () => {
    const { context, target } = world('gateway', 'http://gw.example.com');
    const results = await runSourceChecks(target, context);

    expect(marks(results)).toEqual([
      ['https', 'failed'],
      ['cors', 'skipped'],
      ['version', 'skipped'],
      ['chunk', 'skipped'],
      ['bytes', 'skipped'],
      ['feed', 'skipped'],
    ]);
    expect(results[0]).toMatchObject({ failure: NOT_HTTPS });
    expect(firstFailure(results)).toEqual(NOT_HTTPS);
    expect(checksPassed(results)).toBe(false);
  });

  it('find a gateway that answers and does not allow this site, with what its operator has to do', async () => {
    const { source, context, target } = world();
    source.answers['feed-entry'] = noAnswer;
    source.found = { kind: 'refuses-this-site' };
    const results = await runSourceChecks(target, context);

    expect(marks(results).slice(0, 3)).toEqual([
      ['https', 'passed'],
      ['cors', 'failed'],
      ['version', 'skipped'],
    ]);
    expect(results[1]).toMatchObject({ failure: corsRefused('gateway', 'https://viewer.example.com') });
    expect(corsRefused('gateway', '').fix).toBe("Its operator has to add this site to Bee's cors-allowed-origins.");
  });

  it('pass a gateway that does not say which Bee it runs, and say so, and fail one older than 2.6', async () => {
    const quiet = world();
    quiet.source.found = { kind: 'not-swarm' };
    const passed = await runSourceChecks(quiet.target, quiet.context);
    expect(passed[2]).toMatchObject({ state: 'passed', note: VERSION_NOT_STATED });

    const old = world();
    old.source.found = { kind: 'not-ready', reason: { kind: 'too-old', version: '2.5.0', needed: '2.6.0' } };
    const failed = await runSourceChecks(old.target, old.context);
    expect(failed[2]).toMatchObject({
      state: 'failed',
      failure: notReady({ kind: 'too-old', version: '2.5.0', needed: '2.6.0' }),
    });
  });

  it("read a chunk the way the chat history reads, through the source's chat route", async () => {
    const { source, chat, context, target } = world();
    await runSourceChecks(target, context);

    expect(chat.asked).toEqual(['chunk']);
    expect(source.asked).not.toContain('chunk');
    expect(source.asked).toContain('bytes');
  });

  it('say what a read that failed found, and run nothing after it', async () => {
    const { chat, context, target } = world();
    chat.answers.chunk = { kind: 'not-found', serverTimeMs: null };
    const results = await runSourceChecks(target, context);

    expect(results[3]).toMatchObject({
      state: 'failed',
      failure: readFailure('a chunk', { kind: 'not-found', serverTimeMs: null }),
    });
    expect(marks(results).slice(4)).toEqual([
      ['bytes', 'skipped'],
      ['feed', 'skipped'],
    ]);
  });

  it("fail a source whose stream list is not this event's", async () => {
    const { source, context, target } = world();
    source.answers['feed-head'] = text('<html>');
    const results = await runSourceChecks(target, context);

    expect(results[5]).toMatchObject({ state: 'failed', failure: NOT_THE_STREAM_LIST });
  });

  it('say so when the event has nothing to read yet', async () => {
    const { source, context, target } = world();
    source.answers['feed-head'] = text('[]');
    const results = await runSourceChecks(target, { ...context, knownStreams: [] });

    expect(results[3]).toMatchObject({ state: 'failed', failure: NOTHING_TO_READ });
  });

  it('end where they are when stopped, and say nothing passed', async () => {
    const { context, target } = world();
    const stopper = new AbortController();
    stopper.abort();
    const results = await runSourceChecks(target, { ...context, signal: stopper.signal });

    expect(checksPassed(results)).toBe(false);
  });
});

describe("the checks before a Bee node of the viewer's own is added", () => {
  it('take a node on this computer and pass it once it is ready', async () => {
    const { context, target } = world('bee-node', 'http://localhost:1633');
    const results = await runSourceChecks(target, context);

    expect(results.map(({ step }) => step)).toEqual(['reach', 'cors', 'version', 'chunk', 'bytes', 'feed']);
    expect(checksPassed(results)).toBe(true);
  });

  it('refuse plain http to another machine before asking it anything', async () => {
    const { source, context, target } = world('bee-node', 'http://192.0.2.10:1633');
    const results = await runSourceChecks(target, context);

    expect(results[0].state).toBe('failed');
    expect(source.asked).toEqual([]);
  });

  it('fail a node still starting, and say to wait', async () => {
    const { source, context, target } = world('bee-node', 'http://localhost:1633');
    source.found = { kind: 'not-ready', reason: { kind: 'starting' } };
    const results = await runSourceChecks(target, context);

    expect(results[2]).toMatchObject({ state: 'failed', failure: notReady({ kind: 'starting' }) });
  });

  it("give the viewer the exact cors-allowed-origins lines for this page's origin", async () => {
    const { source, context, target } = world('bee-node', 'http://localhost:1633');
    source.answers['feed-entry'] = noAnswer;
    source.found = { kind: 'refuses-this-site' };
    const results = await runSourceChecks(target, context);

    const failure = results[1].state === 'failed' ? results[1].failure : null;
    expect(failure?.help?.steps[0].code).toBe('cors-allowed-origins: ["https://viewer.example.com"]');
  });
});

describe('the checks before the node in this browser is added', () => {
  it('wait for the node to start and reach 20 peers, then read through it', async () => {
    const { source, context, target } = world('weeb-3', '');
    const states: ProviderStatus[] = [
      { state: 'starting', peers: 0, download: { receivedBytes: 1, totalBytes: 10 } },
      { state: 'starting', peers: 0 },
      { state: 'ready', peers: 5 },
      { state: 'ready', peers: 25 },
    ];
    source.status = () => (states.length > 1 ? (states.shift() as ProviderStatus) : states[0]);
    const results = await runSourceChecks(target, context);

    expect(marks(results)).toEqual([
      ['start', 'passed'],
      ['peers', 'passed'],
      ['chunk', 'passed'],
      ['bytes', 'passed'],
      ['feed', 'passed'],
    ]);
  });

  it("read the stream list's entry the page shows, its newest, by its index rather than by a slow head search", async () => {
    const { source, context, target } = world('weeb-3', '');
    source.current = { state: 'ready', peers: 25 };
    const results = await runSourceChecks(target, { ...context, streamListSlot: 41n });

    expect(results.at(-1)).toMatchObject({ step: 'feed', state: 'passed' });
    expect(source.streamListReads).toEqual(['entry 41']);
  });

  it("search the stream list's head, as the page does, when the page has not read the list", async () => {
    const { source, context, target } = world('weeb-3', '');
    source.current = { state: 'ready', peers: 25 };
    const results = await runSourceChecks(target, { ...context, knownStreams: [], streamListSlot: null });

    expect(results.at(-1)).toMatchObject({ step: 'feed', state: 'passed' });
    expect(source.streamListReads).toEqual(['head', 'head']);
  });

  it('fail a node that did not start', async () => {
    const { source, context, target } = world('weeb-3', '');
    source.current = { state: 'failed', peers: 0 };
    const results = await runSourceChecks(target, context);

    expect(results[0]).toMatchObject({ state: 'failed', failure: NODE_FAILED });
  });

  it('fail a node that found too few peers in its minute', async () => {
    const { source, context, target } = world('weeb-3', '');
    source.current = { state: 'ready', peers: 7 };
    const results = await runSourceChecks(target, context);

    expect(results[1].state).toBe('failed');
    expect(results[1].state === 'failed' && results[1].failure.reason).toBe(tooFewPeers(7, 60_000).reason);
  });
});
