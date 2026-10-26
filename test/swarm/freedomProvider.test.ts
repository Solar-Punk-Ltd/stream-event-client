import { FeedIndex, Identifier, PrivateKey, Topic } from '@ethersphere/bee-js';
import { describe, expect, it } from 'vitest';

import { makeFeedIdentifier } from '../../src/shared/feedFollow';
import type { SwarmAnswer } from '../../src/swarm/answers';
import { createSwarmClient } from '../../src/swarm/createSwarmClient';
import { FreedomProvider } from '../../src/swarm/providers/freedom/freedomProvider';
import type { FreedomSwarm } from '../../src/swarm/providers/freedom/freedomSwarm';
import { MAX_CHUNK_PAYLOAD, parseSingleOwnerChunk } from '../../src/swarm/singleOwnerChunk';
import {
  contentAddressOf,
  fakeFreedom,
  type FakeFreedomOptions,
  type FreedomWorld,
  signedSoc,
} from '../helpers/fakeFreedom';
import { ScriptedProvider } from '../helpers/scriptedProvider';
import { type ContractHarness, describeProviderContract } from './providerContract';

const KEY = new PrivateKey('c3'.repeat(32));
const OWNER = KEY.publicKey().address().toHex();
const TOPIC = Topic.fromString('freedom-contract');
const NEWEST = 4;
const ENTRY_INDEX = 3;
const SOC_IDENTIFIER = new Identifier('11'.repeat(32));
const REFERENCE = 'ef'.repeat(32);
const WINDOW_MS = 60_000;

const text = (value: string) => new TextEncoder().encode(value);

const ENTRIES = Array.from({ length: NEWEST + 1 }, (_, index) => text(`#EXTM3U entry ${index}`));
const SOC_PAYLOAD = text('a ladder marker');
const SOC = signedSoc(KEY, SOC_IDENTIFIER, SOC_PAYLOAD);
const CHUNK_PAYLOAD = text('a content-addressed chunk');
const CHUNK_ADDRESS = contentAddressOf(CHUNK_PAYLOAD);
const SEGMENT_BYTES = text('a whole segment, joined from its chunks');

/** What Bee's `/chunks` answers for a content-addressed chunk: its span, little-endian, then its payload. */
function spanned(payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(8 + payload.length);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(payload.length), true);
  bytes.set(payload, 8);
  return bytes;
}

const WORLD: FreedomWorld = {
  feeds: { [`${OWNER}/${TOPIC.toHex()}`]: ENTRIES },
  socs: [SOC],
  chunks: { [CHUNK_ADDRESS]: CHUNK_PAYLOAD },
  data: { [REFERENCE]: SEGMENT_BYTES },
};

const freedom = (swarm: FreedomSwarm | null, overBudget?: ScriptedProvider, now?: () => number) =>
  new FreedomProvider({ swarm, overBudget, now });

function freedomHarness(): ContractHarness {
  return {
    world: {
      feedHead: { owner: OWNER, topic: TOPIC, index: NEWEST, bytes: ENTRIES[NEWEST], serverTimeMs: null },
      feedEntry: { owner: OWNER, topic: TOPIC, index: ENTRY_INDEX, bytes: ENTRIES[ENTRY_INDEX] },
      soc: { owner: OWNER, identifier: SOC_IDENTIFIER.toHex(), bytes: SOC_PAYLOAD },
      chunk: { address: CHUNK_ADDRESS, bytes: spanned(CHUNK_PAYLOAD) },
      bytes: { reference: REFERENCE, bytes: SEGMENT_BYTES },
      absent: {
        owner: OWNER,
        topic: Topic.fromString('nothing-was-published-here'),
        index: 7,
        identifier: 'cd'.repeat(32),
        address: 'ab'.repeat(32),
        reference: 'cd'.repeat(32),
      },
    },
    retryAfterMs: WINDOW_MS,
    // A clock that stands still, so a refusal names the whole window as what is left of it.
    provider: (behaviour) => freedom(fakeFreedom(WORLD, { behaviour }), undefined, () => 0),
  };
}

describeProviderContract("the Freedom browser's node", freedomHarness);

/** A `window.swarm` that rejects every call with `error`, as Freedom's shim hands its errors back. */
function rejecting(error: unknown): FreedomSwarm {
  return { isFreedomBrowser: true, request: () => Promise.reject(error) };
}

const freedomError = (code: number, message: string, data?: Record<string, unknown>) =>
  Object.assign(new Error(message), { code, ...(data && { data }) });

describe("the Freedom browser's node, read through window.swarm", () => {
  it("reads every kind of read through Freedom's public reads, an index named only where one is asked", async () => {
    const swarm = fakeFreedom(WORLD);
    const provider = freedom(swarm);

    await provider.readFeedHead(OWNER, TOPIC);
    await provider.readFeedEntry(OWNER, TOPIC, ENTRY_INDEX);
    await provider.readSoc(OWNER, SOC_IDENTIFIER.toHex());
    await provider.readChunk(CHUNK_ADDRESS);
    await provider.readBytes(REFERENCE);

    expect(swarm.calls).toEqual([
      { method: 'swarm_readFeedEntry', params: { topic: TOPIC.toHex(), owner: OWNER } },
      { method: 'swarm_readFeedEntry', params: { topic: TOPIC.toHex(), owner: OWNER, index: ENTRY_INDEX } },
      { method: 'swarm_readSingleOwnerChunk', params: { owner: OWNER, identifier: SOC_IDENTIFIER.toHex() } },
      { method: 'swarm_readChunk', params: { reference: CHUNK_ADDRESS } },
      { method: 'swarm_readData', params: { reference: REFERENCE } },
    ]);
  });

  it("names the feed index Freedom's head lookup found, and an entry's own index", async () => {
    const provider = freedom(fakeFreedom(WORLD));

    expect(await provider.readFeedHead(OWNER, TOPIC)).toMatchObject({ kind: 'content', feedIndex: NEWEST });
    expect(await provider.readFeedEntry(OWNER, TOPIC, 2)).toMatchObject({ kind: 'content', feedIndex: 2 });
  });

  it('answers unsupported for an index that names no entry, without asking Freedom', async () => {
    const swarm = fakeFreedom(WORLD);

    expect(await freedom(swarm).readFeedEntry(OWNER, TOPIC, -1)).toEqual({ kind: 'unsupported' });
    expect(swarm.calls).toEqual([]);
  });

  it('is given a 15 s window, for reads that ask the node whether it is up before every read and miss in about 2 s', () => {
    expect(freedom(fakeFreedom(WORLD)).shortestReadWindowMs).toBe(15_000);
  });

  describe("Freedom's errors, each an answer and never a rejection", () => {
    it.each<[string, unknown, SwarmAnswer]>([
      ['an empty feed', freedomError(-32602, 'Feed is empty', { reason: 'feed_empty' }), notFound()],
      ['an entry not written', freedomError(-32602, 'Not found', { reason: 'entry_not_found' }), notFound()],
      ['a chunk not found', freedomError(-32602, 'Not found', { reason: 'chunk_not_found' }), notFound()],
      [
        'a read over the budget, with its window as the wait',
        freedomError(-32602, 'Permission-free read budget exceeded', { reason: 'rate_limited', windowMs: 60_000 }),
        { kind: 'rate-limited', retryAfterMs: 60_000, serverTimeMs: null },
      ],
      [
        'a read over the budget that names no window, with Freedom’s minute as the wait',
        freedomError(-32602, 'Permission-free read budget exceeded', { reason: 'rate_limited' }),
        { kind: 'rate-limited', retryAfterMs: 60_000, serverTimeMs: null },
      ],
      [
        'a request Freedom will never serve',
        freedomError(-32602, 'Invalid', { reason: 'invalid_reference' }),
        { kind: 'unsupported' },
      ],
      ['a method this Freedom does not know', freedomError(4200, 'Unknown method'), { kind: 'unsupported' }],
    ])('%s', async (_what, error, expected) => {
      expect(await freedom(rejecting(error)).readChunk(CHUNK_ADDRESS)).toEqual(expected);
    });

    it('answers a node that is not running as unavailable, saying so', async () => {
      const answer = await freedom(
        rejecting(freedomError(4900, 'Node not available: node-stopped', { reason: 'node-stopped' })),
      ).readBytes(REFERENCE);

      expect(answer).toMatchObject({ kind: 'unavailable', cause: { kind: 'network' } });
      expect(String((answer as { cause: { error: unknown } }).cause.error)).toContain('node-stopped');
    });

    it("answers Freedom's Swarm access switched off as unavailable, saying so", async () => {
      const answer = await freedom(rejecting(freedomError(4900, 'Swarm provider is not available'))).readBytes(
        REFERENCE,
      );

      expect(String((answer as { cause: { error: unknown } }).cause.error)).toContain(
        "switched off in Freedom's settings",
      );
    });

    it("answers the shim's own timeout as a timeout, inside the read's window", async () => {
      const answer = await freedom(rejecting(freedomError(-32603, 'Request timed out'))).readFeedHead(OWNER, TOPIC, {
        timeoutMs: 15_000,
      });

      expect(answer).toEqual({ kind: 'unavailable', cause: { kind: 'timeout', timeoutMs: 15_000 } });
    });

    it.each<[string, unknown]>([
      ['a Bee error Freedom passed through', freedomError(-32603, 'Request failed with status code 500')],
      ['something that is not an error at all', 'gone'],
      ['an error with no code', new TypeError('Failed')],
    ])('answers %s as unavailable', async (_what, error) => {
      expect(await freedom(rejecting(error)).readSoc(OWNER, SOC_IDENTIFIER.toHex())).toMatchObject({
        kind: 'unavailable',
        cause: { kind: 'network' },
      });
    });

    it('answers unavailable where Freedom throws rather than rejects', async () => {
      const throwing: FreedomSwarm = {
        isFreedomBrowser: true,
        request: () => {
          throw new Error('not callable here');
        },
      };

      expect(await freedom(throwing).readBytes(REFERENCE)).toMatchObject({ kind: 'unavailable' });
    });

    it('answers unavailable for every read where the page is not open in Freedom', async () => {
      const provider = freedom(null);

      for (const answer of [
        await provider.readFeedHead(OWNER, TOPIC),
        await provider.readChunk(CHUNK_ADDRESS),
        await provider.readBytes(REFERENCE),
      ]) {
        expect(answer).toMatchObject({ kind: 'unavailable', cause: { kind: 'network' } });
      }
    });
  });

  describe('a single-owner chunk whose body is longer than one chunk', () => {
    const body = new Uint8Array(MAX_CHUNK_PAYLOAD * 2 + 100).map((_, at) => at % 251);
    // The root of the body's tree is what the entry wraps: its payload is the addresses of the leaves, its span the
    // whole length. Its address is the wrapped chunk's, which the body is then read at.
    const rootPayload = new Uint8Array(3 * 32).fill(0x42);
    const identifier = makeFeedIdentifier(TOPIC, FeedIndex.fromBigInt(9n));
    const soc = signedSoc(KEY, identifier, rootPayload, BigInt(body.length));
    const rootAddress = (() => {
      const bytes = new Uint8Array(8 + rootPayload.length);
      new DataView(bytes.buffer).setBigUint64(0, BigInt(body.length), true);
      bytes.set(rootPayload, 8);
      return parseSingleOwnerChunk(
        new Uint8Array([...identifier.toUint8Array(), ...Uint8Array.from(Buffer.from(soc.signature, 'hex')), ...bytes]),
        soc.address,
      ).wrappedAddress;
    })();

    it('reads the body whole at the wrapped chunk address, as Bee joins it', async () => {
      const swarm = fakeFreedom({ socs: [soc], data: { [rootAddress]: body } });

      const answer = await freedom(swarm).readSoc(OWNER, identifier.toHex());

      expect(answer).toMatchObject({ kind: 'content', bytes: body });
      expect(swarm.calls.map(({ method, params }) => [method, params.reference ?? null])).toEqual([
        ['swarm_readSingleOwnerChunk', null],
        ['swarm_readData', rootAddress],
      ]);
    });

    it('answers unavailable for a body of another length than the span says', async () => {
      const swarm = fakeFreedom({ socs: [soc], data: { [rootAddress]: body.slice(1) } });

      expect(await freedom(swarm).readSoc(OWNER, identifier.toHex())).toMatchObject({ kind: 'unavailable' });
    });

    it('answers not found where the body under the root is not there', async () => {
      const swarm = fakeFreedom({ socs: [soc] });

      expect(await freedom(swarm).readSoc(OWNER, identifier.toHex())).toMatchObject({ kind: 'not-found' });
    });
  });

  describe('a chunk read at a single-owner chunk address', () => {
    it("is read as that single-owner chunk and given back whole, which the chat's own check accepts as its owner's", async () => {
      const swarm = fakeFreedom(WORLD);

      const answer = await freedom(swarm).readChunk(SOC.address);

      expect(swarm.calls.map(({ method }) => method)).toEqual(['swarm_readChunk', 'swarm_readSingleOwnerChunk']);
      expect(swarm.calls[1].params).toEqual({ address: SOC.address });
      assertContent(answer);
      const parsed = parseSingleOwnerChunk(answer.bytes, SOC.address);
      expect(parsed.owner).toBe(OWNER);
      expect(parsed.payload).toEqual(SOC_PAYLOAD);
    });

    it('answers not found for an address that holds neither kind of chunk', async () => {
      expect(await freedom(fakeFreedom(WORLD)).readChunk('ab'.repeat(32))).toMatchObject({ kind: 'not-found' });
    });
  });

  describe('a read the caller stops, which Freedom cannot cancel', () => {
    it('answers aborted at once, and drops the result that lands after', async () => {
      let answerLate: (value: unknown) => void = () => undefined;
      const late: FreedomSwarm = {
        isFreedomBrowser: true,
        request: () =>
          new Promise((resolve) => {
            answerLate = resolve;
          }),
      };
      const controller = new AbortController();
      const pending = freedom(late).readBytes(REFERENCE, { signal: controller.signal });

      controller.abort();
      const answer = await pending;
      answerLate({ data: Buffer.from(SEGMENT_BYTES).toString('base64'), encoding: 'base64' });

      expect(answer).toEqual({ kind: 'aborted' });
    });
  });

  describe("URLs, Freedom's own bzz:// scheme for each, which its node serves with no read budget", () => {
    it.each(['segment', 'preview-segment', 'thumbnail'] as const)('a %s', (use) => {
      expect(freedom(fakeFreedom()).urlFor(REFERENCE, use)).toBe(`bzz://${REFERENCE}/`);
    });

    it('encodes a reference that came from the stream list, external input', () => {
      expect(freedom(fakeFreedom()).urlFor(' a/b?c ', 'thumbnail')).toBe('bzz://a%2Fb%3Fc/');
    });
  });

  describe('its status and probe', () => {
    it('is ready in Freedom, which runs the node itself, and failed outside it', () => {
      expect(freedom(fakeFreedom()).status()).toEqual({ state: 'ready' });
      expect(freedom(null).status()).toEqual({ state: 'failed' });
    });

    it('answers ok when Freedom answers its capabilities, and asks nothing the read budget counts', async () => {
      const swarm = fakeFreedom();

      expect(await freedom(swarm).probe()).toMatchObject({ kind: 'ok' });
      expect(swarm.calls.map(({ method }) => method)).toEqual(['swarm_getCapabilities']);
    });

    it.each<[string, FakeFreedomOptions, unknown]>([
      ['a connected site whose node is not running', { connected: true, behaviour: 'node-stopped' }, nodeStopped()],
      [
        "Freedom's Swarm access switched off",
        { behaviour: 'switched-off' },
        { kind: 'not-ready', reason: { kind: 'switched-off' } },
      ],
    ])('answers not ready for %s', async (_what, options, expected) => {
      expect(await freedom(fakeFreedom({}, options)).probe()).toEqual(expected);
    });

    it('answers not ready for a node Freedom reports not running', async () => {
      const swarm = rejecting(freedomError(4900, 'Node not available: node-stopped', { reason: 'node-stopped' }));

      expect(await freedom(swarm).probe()).toEqual(nodeStopped());
    });

    it('answers unreachable outside Freedom, and timed out when Freedom does not answer', async () => {
      const silent: FreedomSwarm = { isFreedomBrowser: true, request: () => new Promise(() => undefined) };

      expect(await freedom(null).probe()).toEqual({ kind: 'unreachable' });
      expect(await freedom(silent).probe({ timeoutMs: 20 })).toEqual({ kind: 'timed-out' });
    });

    it('answers rejected with the code Freedom sent, never unreachable, for any other error of a Freedom that is there', async () => {
      const internal = rejecting(freedomError(-32603, 'Request failed with status code 500'));
      const unauthorized = rejecting(freedomError(4100, 'Unauthorized'));

      expect(await freedom(internal).probe()).toEqual({ kind: 'rejected', status: -32603 });
      expect(await freedom(unauthorized).probe()).toEqual({ kind: 'rejected', status: 4100 });
    });

    it('answers not Swarm, naming no code Freedom never sent, for an answer of no shape or an error with no code', async () => {
      const unknown = rejecting('something Freedom does not document');
      const shapeless: FreedomSwarm = { isFreedomBrowser: true, request: () => Promise.resolve(null) };

      expect(await freedom(unknown).probe()).toEqual({ kind: 'not-swarm' });
      expect(await freedom(shapeless).probe()).toEqual({ kind: 'not-swarm' });
    });

    it('answers unreachable for a probe the caller stopped', async () => {
      const stopped = new AbortController();
      stopped.abort();

      expect(await freedom(fakeFreedom()).probe({ signal: stopped.signal })).toEqual({ kind: 'unreachable' });
    });
  });

  describe("over Freedom's read budget", () => {
    it('reads through the event gateway for the window Freedom named, then through Freedom again', async () => {
      let nowMs = 0;
      const swarm = fakeFreedom(WORLD, { budget: { maxRequests: 2, windowMs: WINDOW_MS, now: () => nowMs } });
      const gateway = new ScriptedProvider('event gateway');
      const provider = freedom(swarm, gateway, () => nowMs);

      expect(await provider.readFeedEntry(OWNER, TOPIC, 0)).toMatchObject({ kind: 'content', bytes: ENTRIES[0] });
      expect(await provider.readFeedEntry(OWNER, TOPIC, 1)).toMatchObject({ kind: 'content', bytes: ENTRIES[1] });
      // The third is refused for the budget and read through the gateway, and so is the one after, without Freedom.
      expect(await provider.readFeedEntry(OWNER, TOPIC, 2)).toMatchObject({
        kind: 'content',
        bytes: new Uint8Array([1]),
      });
      nowMs = 30_000;
      expect(await provider.readFeedEntry(OWNER, TOPIC, 3)).toMatchObject({ kind: 'content' });
      expect(swarm.calls).toHaveLength(3);
      expect(gateway.asked).toEqual(['feed-entry', 'feed-entry']);

      nowMs = WINDOW_MS + 1;
      expect(await provider.readFeedEntry(OWNER, TOPIC, 4)).toMatchObject({ kind: 'content', bytes: ENTRIES[4] });
      expect(swarm.calls).toHaveLength(4);
    });

    it('reads through Freedom again as soon as its fixed window ends, not a whole window after the refusal', async () => {
      let nowMs = 0;
      const swarm = fakeFreedom(WORLD, { budget: { maxRequests: 2, windowMs: WINDOW_MS, now: () => nowMs } });
      const gateway = new ScriptedProvider('event gateway');
      const provider = freedom(swarm, gateway, () => nowMs);

      await provider.readFeedEntry(OWNER, TOPIC, 0);
      nowMs = 50_000;
      await provider.readFeedEntry(OWNER, TOPIC, 1);
      // Refused 55 s into Freedom's window, which then has 5 s left.
      nowMs = 55_000;
      expect(await provider.readFeedEntry(OWNER, TOPIC, 2)).toMatchObject({ bytes: new Uint8Array([1]) });
      nowMs = WINDOW_MS - 1;
      await provider.readFeedEntry(OWNER, TOPIC, 3);
      expect(swarm.calls).toHaveLength(3);
      expect(gateway.asked).toEqual(['feed-entry', 'feed-entry']);

      nowMs = WINDOW_MS;
      expect(await provider.readFeedEntry(OWNER, TOPIC, 4)).toMatchObject({ kind: 'content', bytes: ENTRIES[4] });
      expect(swarm.calls).toHaveLength(4);
    });

    it('holds reads back only a moment for a refusal that lands after the window the page counted', async () => {
      let nowMs = 0;
      // Freedom's window started as the read reached it, so its refusal can land after the end of the page's window.
      const swarm: FreedomSwarm = {
        isFreedomBrowser: true,
        request: async () => {
          nowMs += WINDOW_MS + 500;
          throw freedomError(-32602, 'Permission-free read budget exceeded', {
            reason: 'rate_limited',
            windowMs: WINDOW_MS,
          });
        },
      };
      const provider = freedom(swarm, undefined, () => nowMs);

      expect(await provider.readFeedHead(OWNER, TOPIC)).toEqual({
        kind: 'rate-limited',
        retryAfterMs: 1_000,
        serverTimeMs: null,
      });
    });

    it("holds reads back only a moment for a refusal of a new window's first read, which reached Freedom in its last", async () => {
      let nowMs = 0;
      // The window's first read reached Freedom 5 ms after it was sent, so Freedom's window ends 5 ms after the page's.
      const freedomStartedAtMs = 5;
      let reads = 0;
      const swarm: FreedomSwarm = {
        isFreedomBrowser: true,
        request: async () => {
          reads += 1;
          if (reads === 1 || nowMs >= freedomStartedAtMs + WINDOW_MS) {
            return { data: Buffer.from(ENTRIES[0]).toString('base64'), encoding: 'base64', index: 0 };
          }
          throw freedomError(-32602, 'Permission-free read budget exceeded', {
            reason: 'rate_limited',
            windowMs: WINDOW_MS,
          });
        },
      };
      const provider = freedom(swarm, undefined, () => nowMs);

      await provider.readFeedHead(OWNER, TOPIC);
      nowMs = 20_000;
      expect(await provider.readFeedHead(OWNER, TOPIC)).toMatchObject({ retryAfterMs: WINDOW_MS - 20_000 });
      // Sent after the page's window ended and refused in Freedom's, which has a moment left.
      nowMs = WINDOW_MS + 2;
      expect(await provider.readFeedHead(OWNER, TOPIC)).toEqual({
        kind: 'rate-limited',
        retryAfterMs: 1_000,
        serverTimeMs: null,
      });
      nowMs = WINDOW_MS + 1_002;
      expect(await provider.readFeedHead(OWNER, TOPIC)).toMatchObject({ kind: 'content' });
    });

    it('answers rate limited with what is left of the window as the wait where no gateway is there', async () => {
      let nowMs = 0;
      const swarm = fakeFreedom(WORLD, { budget: { maxRequests: 1, windowMs: WINDOW_MS, now: () => nowMs } });
      const provider = freedom(swarm, undefined, () => nowMs);

      await provider.readFeedHead(OWNER, TOPIC);
      nowMs = 20_000;
      expect(await provider.readFeedHead(OWNER, TOPIC)).toEqual({
        kind: 'rate-limited',
        retryAfterMs: WINDOW_MS - 20_000,
        serverTimeMs: null,
      });
    });

    it("sends every part to the gateway after one part's refusal, since Freedom counts the site's reads together", async () => {
      let nowMs = 0;
      const swarm = fakeFreedom(WORLD, { budget: { maxRequests: 1, windowMs: WINDOW_MS, now: () => nowMs } });
      const gateway = new ScriptedProvider('event gateway');
      const streamList = freedom(swarm, gateway, () => nowMs);
      const player = freedom(swarm, gateway, () => nowMs);
      const previews = freedom(swarm, gateway, () => nowMs);

      await streamList.readFeedEntry(OWNER, TOPIC, 0);
      await streamList.readFeedEntry(OWNER, TOPIC, 1);
      expect(swarm.refusals).toBe(1);

      await player.readBytes(REFERENCE);
      await previews.readChunk(CHUNK_ADDRESS);
      expect(swarm.refusals).toBe(1);
      expect(swarm.calls).toHaveLength(2);
      expect(gateway.asked).toEqual(['feed-entry', 'bytes', 'chunk']);

      nowMs = WINDOW_MS;
      expect(await player.readBytes(REFERENCE)).toMatchObject({ kind: 'content', bytes: SEGMENT_BYTES });
    });

    it("reads a blob larger than the site's whole byte budget through the gateway, without pausing Freedom", async () => {
      const swarm = fakeFreedom(WORLD, { maxDataBytes: 8 });
      const gateway = new ScriptedProvider('event gateway');
      const provider = freedom(swarm, gateway);

      expect(await provider.readBytes(REFERENCE)).toMatchObject({ kind: 'content' });
      expect(gateway.asked).toHaveLength(1);
      expect(await provider.readChunk(CHUNK_ADDRESS)).toMatchObject({ kind: 'content', bytes: spanned(CHUNK_PAYLOAD) });
    });

    it('answers unsupported for such a blob where no gateway is there', async () => {
      expect(await freedom(fakeFreedom(WORLD, { maxDataBytes: 8 })).readBytes(REFERENCE)).toEqual({
        kind: 'unsupported',
      });
    });
  });
});

describe('the freedom kind, as the Swarm client makes it', () => {
  const EVENT = { id: 'event', kind: 'bee-http', url: 'https://event.example.com' } as const;
  const FREEDOM = { id: 'added-1', kind: 'freedom', url: '' } as const;

  it("is handed the deployment's default gateway to read through while Freedom's budget is spent", async () => {
    const asked: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response('the gateway answered');
    }) as typeof fetch;
    const swarm = fakeFreedom(WORLD, { behaviour: 'rate-limited' });
    Object.assign(globalThis, { window: { swarm } });
    try {
      const client = createSwarmClient(
        { gateways: [EVENT], defaultId: 'event' },
        { choice: FREEDOM, environment: { fetcher, pageOrigin: 'https://viewer.example' } },
      );
      const answer = await client.reader('player').readBytes(REFERENCE);

      expect(answer).toMatchObject({ kind: 'content' });
      expect(asked).toEqual([`https://event.example.com/bytes/${REFERENCE}`]);
    } finally {
      Reflect.deleteProperty(globalThis, 'window');
    }
  });

  it('is handed no gateway where the client is made for it alone, as its checks are', async () => {
    const swarm = fakeFreedom(WORLD, { behaviour: 'rate-limited' });
    Object.assign(globalThis, { window: { swarm } });
    try {
      const client = createSwarmClient({ gateways: [FREEDOM], defaultId: FREEDOM.id });

      expect(await client.reader('player').readBytes(REFERENCE)).toMatchObject({ kind: 'rate-limited' });
    } finally {
      Reflect.deleteProperty(globalThis, 'window');
    }
  });
});

function notFound(): SwarmAnswer {
  return { kind: 'not-found', serverTimeMs: null };
}

function nodeStopped() {
  return { kind: 'not-ready', reason: { kind: 'node-stopped' } };
}

function assertContent(answer: SwarmAnswer): asserts answer is Extract<SwarmAnswer, { kind: 'content' }> {
  expect(answer.kind).toBe('content');
}
