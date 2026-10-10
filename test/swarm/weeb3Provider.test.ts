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

type FakeRuntime = Weeb3RuntimeView & { starts: number; stops: number; readonly attached: unknown[][] };

function runtimeAt(status: Weeb3Status): FakeRuntime {
  const attached: unknown[][] = [];
  const node: Weeb3Node = {
    start: () => undefined,
    connectionCount: async () => status.peers,
    attachStream: async (...args) => void attached.push(args),
    free: () => undefined,
  };
  return {
    starts: 0,
    stops: 0,
    attached,
    status: () => status,
    async start() {
      this.starts += 1;
      return node;
    },
    async stop() {
      this.stops += 1;
    },
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
      feedHead: null,
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

  it('strips the span weeb-3 puts before bytes, which Bee does not', async () => {
    const answer = await weeb3(servedFetch()).provider.readBytes(REFERENCE);

    expect(answer).toMatchObject({ kind: 'content', bytes: SEGMENT_BYTES });
  });

  it("answers unsupported for a single-owner chunk read by its address, whose identifier and signature weeb-3 does not serve, so the chat's check asks another source", async () => {
    const answer = await weeb3(servedFetch()).provider.readChunk(SOC_ADDRESS);

    expect(answer).toEqual({ kind: 'unsupported' });
  });

  it('answers unavailable when weeb-3 sends fewer bytes than a span', async () => {
    const short = (async () => new Response(new Uint8Array(3), { status: 200 })) as typeof fetch;

    expect((await weeb3(short).provider.readBytes(REFERENCE)).kind).toBe('unavailable');
  });

  it("answers unsupported for a feed's head without asking, because weeb-3 has no lookup that reports the index", async () => {
    const log: AskedLog = { urls: [] };
    const answer = await weeb3(servedFetch(log)).provider.readFeedHead(OWNER, TOPIC);

    expect(answer).toEqual({ kind: 'unsupported' });
    expect(log.urls).toEqual([]);
  });

  it("gives a segment's URL on weeb-3's caching route, absolute because it is written into a playlist", () => {
    const { provider } = weeb3(servedFetch());

    expect(provider.urlFor(REFERENCE, 'segment')).toBe(`${PAGE_ORIGIN}/weeb-3/hls/bytes/${REFERENCE}`);
    expect(provider.urlFor(REFERENCE, 'preview-segment')).toBe(`${PAGE_ORIGIN}/weeb-3/hls/bytes/${REFERENCE}`);
    expect(provider.urlFor(` ${REFERENCE} `, 'thumbnail')).toBe(`/weeb-3/bzz/${REFERENCE}/`);
  });

  it('answers unavailable without asking while the node is not ready, and starts it', async () => {
    const log: AskedLog = { urls: [] };
    const { provider, runtime } = weeb3(servedFetch(log), { state: 'stopped', peers: 0 });

    const answer = await provider.readBytes(REFERENCE);

    expect(answer.kind).toBe('unavailable');
    expect(log.urls).toEqual([]);
    expect(runtime.starts).toBe(1);
  });

  it('says where the node is in its own life, and is a node in this tab that start and stop reach', async () => {
    const { provider, runtime } = weeb3(servedFetch(), { state: 'starting', peers: 2 });

    expect(provider.capabilities.inTab).toBe(true);
    expect(provider.capabilities.feedHead).toBe(false);
    expect(provider.status()).toEqual({ state: 'starting', peers: 2 });
    await provider.start();
    await provider.stop();
    expect([runtime.starts, runtime.stops]).toEqual([1, 1]);
  });

  it("brings weeb-3's own player, which starts the node and plays a stream into the page's video", async () => {
    const { provider, runtime } = weeb3(servedFetch(), { state: 'starting', peers: 0 });
    const video = {} as HTMLVideoElement;

    const player = await provider.ownPlayer();
    await player.attach(video, OWNER, 'a-topic', 'live');

    expect(runtime.starts).toBe(1);
    expect(runtime.attached).toEqual([[video, OWNER, 'a-topic', 'live']]);
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
