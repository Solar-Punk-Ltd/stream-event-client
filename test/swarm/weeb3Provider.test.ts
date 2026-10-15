import { ChunkBuilder, FeedIndex, Identifier, Span, Topic } from '@ethersphere/bee-js';
import { describe, expect, it } from 'vitest';

import { makeFeedIdentifier } from '../../src/shared/feedFollow';
import { singleOwnerChunkAddress } from '../../src/swarm/singleOwnerChunk';
import { Weeb3Provider, type Weeb3RuntimeView } from '../../src/swarm/providers/weeb-3/weeb3Provider';
import type { Weeb3Node } from '../../src/swarm/providers/weeb-3/weeb3Package';
import type { Weeb3Status } from '../../src/swarm/providers/weeb-3/weeb3Runtime';
import { type AskedLog, answeringFetch, faultyFetch, silentFetch } from '../helpers/recordedBeeGateway';
import { type ContractHarness, describeProviderContract } from './providerContract';

const PAGE_ORIGIN = 'http://127.0.0.1:4173';
const OWNER = '1234567890abcdef1234567890abcdef12345678';
const TOPIC = Topic.fromString('weeb-3-contract');
const ENTRY_INDEX = 3;
const SOC_IDENTIFIER = '11'.repeat(32);
const REFERENCE = 'ef'.repeat(32);
const ABSENT_ADDRESS = 'ab'.repeat(32);
const RETRY_AFTER_SECONDS = 2;

const text = (value: string) => new TextEncoder().encode(value);

/** What weeb-3 answers for a chunk or for bytes: the 8-byte span, little-endian, then the data. */
function withSpan(data: Uint8Array): Uint8Array {
  const spanned = new Uint8Array(8 + data.length);
  spanned.set(Span.fromBigInt(BigInt(data.length)).toUint8Array());
  spanned.set(data, 8);
  return spanned;
}

function contentAddressOf(payload: Uint8Array): string {
  const chunk = new ChunkBuilder(BigInt(payload.length));
  chunk.writer.buffer.set(payload);
  return chunk.hash().toHex();
}

const ENTRY_BYTES = text('#EXTM3U entry 3');
const ENTRY_ADDRESS = singleOwnerChunkAddress(
  makeFeedIdentifier(TOPIC, FeedIndex.fromBigInt(BigInt(ENTRY_INDEX))),
  OWNER,
);
const SOC_BYTES = text('a ladder marker');
const SOC_ADDRESS = singleOwnerChunkAddress(new Identifier(SOC_IDENTIFIER), OWNER);
const CHUNK_PAYLOAD = text('a content-addressed chunk');
const CHUNK_ADDRESS = contentAddressOf(CHUNK_PAYLOAD);
const SEGMENT_BYTES = text('a whole segment, joined from its chunks');

/** Every path the fake node serves, as weeb-3's service worker would answer it. */
const SERVED: Readonly<Record<string, Uint8Array>> = {
  [`/weeb-3/chunks/${ENTRY_ADDRESS}`]: withSpan(ENTRY_BYTES),
  [`/weeb-3/chunks/${SOC_ADDRESS}`]: withSpan(SOC_BYTES),
  [`/weeb-3/chunks/${CHUNK_ADDRESS}`]: withSpan(CHUNK_PAYLOAD),
  [`/weeb-3/bytes/${REFERENCE}`]: withSpan(SEGMENT_BYTES),
};

function servedFetch(log: AskedLog = { urls: [] }): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    log.urls.push(String(input));
    const path = new URL(String(input), PAGE_ORIGIN).pathname;
    const body = SERVED[path];
    return body
      ? new Response(body.slice(), { status: 200 })
      : new Response('weeb-3 did not retrieve resource', { status: 404 });
  }) as typeof fetch;
}

/** A feed whose entries 0 to `newest` are each served, as weeb-3 serves a feed entry, at its single-owner chunk's address. */
function feedFetch(topic: Topic, newest: number, log: AskedLog = { urls: [] }): typeof fetch {
  const byAddress = new Map<string, number>();
  for (let index = 0; index <= newest; index++) {
    byAddress.set(
      singleOwnerChunkAddress(makeFeedIdentifier(topic, FeedIndex.fromBigInt(BigInt(index))), OWNER),
      index,
    );
  }
  return (async (input: RequestInfo | URL) => {
    log.urls.push(String(input));
    const address = new URL(String(input), PAGE_ORIGIN).pathname.replace('/weeb-3/chunks/', '');
    const index = byAddress.get(address);
    return index === undefined
      ? new Response('weeb-3 did not retrieve resource', { status: 404 })
      : new Response(withSpan(text(`entry ${index}`)).slice(), { status: 200 });
  }) as typeof fetch;
}

type FakeRuntime = Weeb3RuntimeView & {
  holds: number;
  readonly attached: unknown[][];
  /** Every quality the player was set to, -1 being Auto. */
  readonly qualities: number[];
  /** How many calls to set the quality throw first, as weeb-3's does before the stream's qualities have loaded. */
  qualityRefusals: number;
  /** Settles the node's readiness, as the real runtime's peer watch would. */
  settle(ready: boolean): void;
};

function runtimeAt(status: Weeb3Status): FakeRuntime {
  const attached: unknown[][] = [];
  const qualities: number[] = [];
  const quality = { refusals: 0 };
  const node: Weeb3Node = {
    start: () => undefined,
    connectionCount: async () => status.peers,
    attachStream: async (...args) => void attached.push(args),
    setStreamQuality: (_media, level) => {
      if (quality.refusals > 0) {
        quality.refusals -= 1;
        throw new Error('no qualities yet');
      }
      qualities.push(level);
    },
    free: () => undefined,
  };
  let settle: (ready: boolean) => void = () => undefined;
  const readiness = new Promise<Weeb3Node>((resolve, reject) => {
    settle = (ready) => (ready ? resolve(node) : reject(new Error('the node failed to start')));
  });
  return {
    holds: 0,
    attached,
    qualities,
    get qualityRefusals() {
      return quality.refusals;
    },
    set qualityRefusals(count: number) {
      quality.refusals = count;
    },
    settle: (ready) => settle(ready),
    status: () => status,
    async acquire() {
      this.holds += 1;
      return node;
    },
    release() {
      this.holds -= 1;
    },
    restart: () => undefined,
    whenReady: () => (status.state === 'ready' ? Promise.resolve(node) : readiness),
  };
}

const READY: Weeb3Status = { state: 'ready', peers: 5 };

function weeb3(fetcher: typeof fetch, status: Weeb3Status = READY) {
  const runtime = runtimeAt(status);
  return { runtime, provider: new Weeb3Provider({ runtime, fetcher, pageOrigin: PAGE_ORIGIN }) };
}

function weeb3Harness(): ContractHarness {
  return {
    world: {
      feedHead: { owner: OWNER, topic: TOPIC, index: ENTRY_INDEX, bytes: ENTRY_BYTES, serverTimeMs: null },
      feedEntry: { owner: OWNER, topic: TOPIC, index: ENTRY_INDEX, bytes: ENTRY_BYTES },
      soc: { owner: OWNER, identifier: SOC_IDENTIFIER, bytes: SOC_BYTES },
      chunk: { address: CHUNK_ADDRESS, bytes: withSpan(CHUNK_PAYLOAD) },
      bytes: { reference: REFERENCE, bytes: SEGMENT_BYTES },
      absent: {
        owner: OWNER,
        topic: Topic.fromString('nothing-was-published-here'),
        index: 7,
        identifier: '22'.repeat(32),
        address: ABSENT_ADDRESS,
        reference: 'cd'.repeat(32),
      },
    },
    retryAfterMs: RETRY_AFTER_SECONDS * 1000,
    provider: (behaviour) => {
      const fetcher = {
        served: () => servedFetch(),
        silent: () => silentFetch(),
        faulty: () => faultyFetch(),
        'rate-limited': () => answeringFetch(429, { 'retry-after': String(RETRY_AFTER_SECONDS) }),
      }[behaviour]();
      return weeb3(fetcher).provider;
    },
  };
}

describeProviderContract('weeb-3 in this browser', weeb3Harness);

describe('the weeb-3 provider', () => {
  it("reads through weeb-3's own routes on this page, a single-owner chunk at the address its owner and identifier make", async () => {
    const log: AskedLog = { urls: [] };
    const { provider } = weeb3(servedFetch(log));

    await provider.readFeedEntry(OWNER, TOPIC, ENTRY_INDEX);
    await provider.readSoc(OWNER, SOC_IDENTIFIER);
    await provider.readChunk(CHUNK_ADDRESS);
    await provider.readBytes(REFERENCE);

    expect(log.urls).toEqual([
      `${PAGE_ORIGIN}/weeb-3/chunks/${ENTRY_ADDRESS}`,
      `${PAGE_ORIGIN}/weeb-3/chunks/${SOC_ADDRESS}`,
      `${PAGE_ORIGIN}/weeb-3/chunks/${CHUNK_ADDRESS}`,
      `${PAGE_ORIGIN}/weeb-3/bytes/${REFERENCE}`,
    ]);
  });

  it("is given weeb-3's own 30 s budget for every read, longer than the 17 s a missing chunk takes it", () => {
    expect(weeb3(servedFetch()).provider.shortestReadWindowMs).toBe(30_000);
  });

  it('strips the span weeb-3 puts before bytes, which Bee does not', async () => {
    const answer = await weeb3(servedFetch()).provider.readBytes(REFERENCE);

    expect(answer).toMatchObject({ kind: 'content', bytes: SEGMENT_BYTES });
  });

  it("answers unsupported for a single-owner chunk read by its address, whose identifier and signature weeb-3 does not serve, rather than bytes the chat's check would refuse", async () => {
    const answer = await weeb3(servedFetch()).provider.readChunk(SOC_ADDRESS);

    expect(answer).toEqual({ kind: 'unsupported' });
  });

  it("reads the chunk an owner's single-owner chunk wraps, span and payload, by its owner and identifier", async () => {
    const log: AskedLog = { urls: [] };
    const answer = await weeb3(servedFetch(log)).provider.readUnsignedSoc(OWNER, SOC_IDENTIFIER);

    expect(answer).toMatchObject({ kind: 'content', bytes: withSpan(SOC_BYTES) });
    expect(log.urls).toEqual([`${PAGE_ORIGIN}/weeb-3/chunks/${SOC_ADDRESS}`]);
  });

  it('answers not found for a single-owner chunk that is not there, and unavailable for one shorter than a span', async () => {
    const short = (async () => new Response(new Uint8Array(3), { status: 200 })) as typeof fetch;

    expect((await weeb3(servedFetch()).provider.readUnsignedSoc(OWNER, '22'.repeat(32))).kind).toBe('not-found');
    expect((await weeb3(short).provider.readUnsignedSoc(OWNER, SOC_IDENTIFIER)).kind).toBe('unavailable');
  });

  it('answers unavailable when weeb-3 sends fewer bytes than a span', async () => {
    const short = (async () => new Response(new Uint8Array(3), { status: 200 })) as typeof fetch;

    expect((await weeb3(short).provider.readBytes(REFERENCE)).kind).toBe('unavailable');
  });

  it("finds a feed's newest entry by reading entries by index, since weeb-3 has no lookup that reports one", async () => {
    const log: AskedLog = { urls: [] };
    const topic = Topic.fromString('a-long-feed');
    const answer = await weeb3(feedFetch(topic, 137, log)).provider.readFeedHead(OWNER, topic);

    expect(answer).toMatchObject({ kind: 'content', feedIndex: 137, bytes: text('entry 137') });
    expect(log.urls.length).toBeLessThan(40);
  });

  it("searches a feed's head again from the head it found before, so a poll costs one round", async () => {
    const topic = Topic.fromString('a-polled-feed');
    let newest = 137;
    const log: AskedLog = { urls: [] };
    const growing = (async (input: RequestInfo | URL) => feedFetch(topic, newest, log)(input)) as typeof fetch;
    const { provider } = weeb3(growing);

    await provider.readFeedHead(OWNER, topic);
    const first = log.urls.length;
    newest = 139;
    const again = await provider.readFeedHead(OWNER, topic);

    expect(again).toMatchObject({ kind: 'content', feedIndex: 139 });
    expect(log.urls.length - first).toBe(8);
  });

  it('finds a head that went back below the one it found before, rather than keeping the old one', async () => {
    const topic = Topic.fromString('a-shrunk-feed');
    let newest = 137;
    const { provider } = weeb3((async (input: RequestInfo | URL) => feedFetch(topic, newest)(input)) as typeof fetch);

    await provider.readFeedHead(OWNER, topic);
    newest = 40;

    expect(await provider.readFeedHead(OWNER, topic)).toMatchObject({ kind: 'content', feedIndex: 40 });
  });

  it('keeps at most eight reads open at once while it searches', async () => {
    const topic = Topic.fromString('a-counted-feed');
    let open = 0;
    let most = 0;
    const served = feedFetch(topic, 3_000);
    const counting = (async (input: RequestInfo | URL) => {
      open += 1;
      most = Math.max(most, open);
      await new Promise((resolve) => setTimeout(resolve, 1));
      open -= 1;
      return served(input);
    }) as typeof fetch;

    const answer = await weeb3(counting).provider.readFeedHead(OWNER, topic);

    expect(answer).toMatchObject({ kind: 'content', feedIndex: 3_000 });
    expect(most).toBeLessThanOrEqual(8);
  });

  it('answers not found for a feed with no entry 0, which nothing was ever written to', async () => {
    const topic = Topic.fromString('an-empty-feed');

    expect((await weeb3(feedFetch(topic, -1)).provider.readFeedHead(OWNER, topic)).kind).toBe('not-found');
  });

  it('answers the first fault a round met rather than a head it could not prove, and asks nothing after it', async () => {
    const topic = Topic.fromString('a-failing-feed');
    const log: AskedLog = { urls: [] };
    const served = feedFetch(topic, 20, log);
    const refusingAbove = (async (input: RequestInfo | URL) => {
      const asked = log.urls.length;
      const response = await served(input);
      return asked >= 8 ? new Response('busy', { status: 503 }) : response;
    }) as typeof fetch;

    const answer = await weeb3(refusingAbove).provider.readFeedHead(OWNER, topic);

    expect(answer).toEqual({ kind: 'unavailable', cause: { kind: 'status', status: 503 } });
    expect(log.urls.length).toBe(16);
  });

  it("gives a segment's URL on weeb-3's caching route, absolute because it is written into a playlist", () => {
    const { provider } = weeb3(servedFetch());

    expect(provider.urlFor(REFERENCE, 'segment')).toBe(`${PAGE_ORIGIN}/weeb-3/hls/bytes/${REFERENCE}`);
    expect(provider.urlFor(REFERENCE, 'preview-segment')).toBe(`${PAGE_ORIGIN}/weeb-3/hls/bytes/${REFERENCE}`);
    expect(provider.urlFor(` ${REFERENCE} `, 'thumbnail')).toBe(`/weeb-3/bzz/${REFERENCE}/`);
  });

  it('waits for a node that is starting, holding it, and reads once it is ready', async () => {
    const log: AskedLog = { urls: [] };
    const { provider, runtime } = weeb3(servedFetch(log), { state: 'starting', peers: 0 });

    const reading = provider.readBytes(REFERENCE);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(log.urls).toEqual([]);
    expect(runtime.holds).toBe(1);

    runtime.settle(true);
    expect(await reading).toMatchObject({ kind: 'content', bytes: SEGMENT_BYTES });
    expect(runtime.holds).toBe(0);
  });

  it('starts a stopped node for a read, since a part that reads from it needs it, and lets go once answered', async () => {
    const { provider, runtime } = weeb3(servedFetch(), { state: 'stopped', peers: 0 });

    const reading = provider.readBytes(REFERENCE);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.holds).toBe(1);
    runtime.settle(true);

    expect((await reading).kind).toBe('content');
    expect(runtime.holds).toBe(0);
  });

  it('answers unavailable, asking nothing, when the node fails to start', async () => {
    const log: AskedLog = { urls: [] };
    const { provider, runtime } = weeb3(servedFetch(log), { state: 'starting', peers: 0 });

    const reading = provider.readBytes(REFERENCE);
    runtime.settle(false);

    expect(await reading).toMatchObject({ kind: 'unavailable', cause: { kind: 'network' } });
    expect(log.urls).toEqual([]);
    expect(runtime.holds).toBe(0);
  });

  it('answers unavailable at once, asking nothing and starting nothing, while the node has lost its peers', async () => {
    const log: AskedLog = { urls: [] };
    const { provider, runtime } = weeb3(servedFetch(log), { state: 'lost', peers: 0 });

    const answer = await provider.readBytes(REFERENCE);

    expect(answer).toMatchObject({ kind: 'unavailable', cause: { kind: 'network' } });
    expect(String((answer as { cause: { error: unknown } }).cause.error)).toContain(
      'The Swarm node in this browser lost its peers. Open Connect to start it again.',
    );
    expect(log.urls).toEqual([]);
    expect(runtime.holds).toBe(0);
  });

  it('answers aborted when the caller stops a read still waiting for the node', async () => {
    const { provider, runtime } = weeb3(servedFetch(), { state: 'starting', peers: 0 });
    const controller = new AbortController();

    const reading = provider.readBytes(REFERENCE, { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    expect(await reading).toEqual({ kind: 'aborted' });
    expect(runtime.holds).toBe(0);
  });

  it('never starts the node for a probe', async () => {
    const { provider, runtime } = weeb3(servedFetch(), { state: 'stopped', peers: 0 });

    await provider.probe();

    expect(runtime.holds).toBe(0);
  });

  it('says where the node is in its own life, and start and stop reach the node in this tab', async () => {
    const { provider, runtime } = weeb3(servedFetch(), { state: 'starting', peers: 2 });

    expect(provider.status()).toEqual({ state: 'starting', peers: 2, healthyPeers: 200 });
    await provider.start();
    expect(runtime.holds).toBe(1);
    await provider.stop();
    expect(runtime.holds).toBe(0);
  });

  it("brings weeb-3's own player once the node is ready, which holds the node until it detaches", async () => {
    const { provider, runtime } = weeb3(servedFetch(), { state: 'starting', peers: 0 });
    const video = {} as HTMLVideoElement;
    let player: Awaited<ReturnType<typeof provider.ownPlayer>> | null = null;

    void provider.ownPlayer().then((loaded) => (player = loaded));
    await Promise.resolve();
    expect(runtime.holds).toBe(1);
    expect(player).toBeNull();

    runtime.settle(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await player!.attach(video, OWNER, 'a-topic', 'live');
    expect(runtime.attached).toEqual([[video, OWNER, 'a-topic', 'live']]);

    player!.detach();
    expect(runtime.holds).toBe(0);
  });

  it("sets weeb-3's player to choose its quality itself once the stream is attached, as it starts on the highest", async () => {
    const { provider, runtime } = weeb3(servedFetch());
    const video = new EventTarget() as HTMLVideoElement;

    await (await provider.ownPlayer()).attach(video, OWNER, 'a-topic', 'live');

    expect(runtime.qualities).toEqual([-1]);
  });

  it("sets it once the video's metadata has loaded when weeb-3 has no qualities yet at attach", async () => {
    const { provider, runtime } = weeb3(servedFetch());
    runtime.qualityRefusals = 1;
    const video = new EventTarget() as HTMLVideoElement;

    await (await provider.ownPlayer()).attach(video, OWNER, 'a-topic', 'live');
    expect(runtime.qualities).toEqual([]);

    video.dispatchEvent(new Event('loadedmetadata'));
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(runtime.qualities).toEqual([-1]);
  });

  it('lets go of the node when it fails before the player could attach', async () => {
    const { provider, runtime } = weeb3(servedFetch(), { state: 'starting', peers: 0 });

    const loading = provider.ownPlayer();
    runtime.settle(false);

    await expect(loading).rejects.toThrow('failed to start');
    expect(runtime.holds).toBe(0);
  });

  it.each<[Weeb3Status, string]>([
    [{ state: 'stopped', peers: 0 }, 'not-ready'],
    [{ state: 'starting', peers: 0 }, 'not-ready'],
    [{ state: 'failed', peers: 0 }, 'unreachable'],
    [READY, 'ok'],
  ])('probes a node that is %j as %s', async (status, kind) => {
    expect((await weeb3(servedFetch(), status).provider.probe()).kind).toBe(kind);
  });
});
