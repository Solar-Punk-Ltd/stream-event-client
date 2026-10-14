import { Topic } from '@ethersphere/bee-js';
import { describe, expect, it } from 'vitest';

import { GatewayClock } from '../../src/shared/gatewayClock';
import { SwarmClient, type SwarmClientOptions } from '../../src/swarm/client';
import { DEFAULT_READ_TIMEOUT_MS } from '../../src/swarm/provider';
import { BeeHttpProvider } from '../../src/swarm/providers/bee-http/beeHttpProvider';
import { Weeb3Provider } from '../../src/swarm/providers/weeb-3/weeb3Provider';
import { answeringFetch } from '../helpers/recordedBeeGateway';
import { content, fault, notFound, ScriptedProvider } from '../helpers/scriptedProvider';

const OWNER = '1'.repeat(40);
const TOPIC = Topic.fromString('client-test');
const REFERENCE = 'ef'.repeat(32);

interface World {
  readonly chosen: ScriptedProvider;
  /** A provider the client holds for the chat alone, which no other feature may ever reach. */
  readonly other: ScriptedProvider;
  readonly client: SwarmClient;
  /** Moves the client's clock on. */
  advance(ms: number): void;
}

function world(options: Partial<SwarmClientOptions> = {}): World {
  const chosen = new ScriptedProvider('chosen');
  const other = new ScriptedProvider('other');
  let nowMs = 0;
  const client = new SwarmClient({
    chosen: { id: 'chosen', provider: chosen },
    routes: { chat: { id: 'other', provider: other } },
    now: () => nowMs,
    ...options,
  });
  return {
    chosen,
    other,
    client,
    advance: (ms) => {
      nowMs += ms;
    },
  };
}

const readBytes = (client: SwarmClient) => client.reader('player').readBytes(REFERENCE);

describe('the Swarm client', () => {
  it("answers a feature's read from the chosen provider, as that provider answered it", async () => {
    const { chosen, client } = world({ routes: {} });
    chosen.answer = content();

    expect(await client.reader('stream-list').readFeedHead(OWNER, TOPIC)).toBe(chosen.answer);
    expect(await client.reader('player').readFeedEntry(OWNER, TOPIC, 4)).toBe(chosen.answer);
    expect(await client.reader('player').readSoc(OWNER, REFERENCE)).toBe(chosen.answer);
    expect(await client.reader('chat').readChunk(REFERENCE)).toBe(chosen.answer);
    expect(await client.reader('previews').readBytes(REFERENCE)).toBe(chosen.answer);
    expect(chosen.asked).toEqual(['feed-head', 'feed-entry', 'soc', 'chunk', 'bytes']);
  });

  describe('never switching source', () => {
    it.each([
      ['a fault', fault],
      ['unsupported', { kind: 'unsupported' as const }],
      ['a rate limit', { kind: 'rate-limited' as const, retryAfterMs: 1_000, serverTimeMs: null }],
      ['not found', notFound],
    ])("answers %s from the feature's own provider and asks nobody else", async (_, answer) => {
      const { chosen, other, client } = world();
      chosen.answer = answer;
      other.answer = content();

      for (let read = 0; read < 5; read += 1) {
        expect(await readBytes(client)).toBe(answer);
      }
      expect(chosen.asked).toHaveLength(5);
      expect(other.asked).toEqual([]);
    });

    it('keeps asking a provider that keeps failing, with no pause, since the viewer picked it', async () => {
      const { chosen, client, advance } = world();
      chosen.answer = fault;
      for (let read = 0; read < 10; read += 1) {
        await readBytes(client);
        advance(100);
      }
      chosen.answer = content();

      expect(await readBytes(client)).toBe(chosen.answer);
      expect(chosen.asked).toHaveLength(11);
    });

    it('takes a chat slot Bee answers 500 for as not there', async () => {
      const bee = new BeeHttpProvider({ baseUrl: 'http://bee.example', fetcher: answeringFetch(500) });
      const client = new SwarmClient({ chosen: { id: 'event', provider: bee } });

      expect(await client.reader('chat').readChunk(REFERENCE)).toMatchObject({ kind: 'not-found' });
    });
  });

  it('routes a feature to the provider it is given, and every other feature to the chosen one', async () => {
    const { chosen, other, client } = world();
    other.answer = fault;

    await client.reader('chat').readChunk(REFERENCE);
    await client.reader('player').readChunk(REFERENCE);

    expect(other.asked).toEqual(['chunk']);
    expect(chosen.asked).toEqual(['chunk']);
  });

  describe("a read's window", () => {
    it("gives the provider the caller's window, or the default when the caller names none", async () => {
      const { chosen, client } = world();

      await client.reader('player').readBytes(REFERENCE, { timeoutMs: 1_000 });
      await readBytes(client);

      expect(chosen.windows).toEqual([1_000, DEFAULT_READ_TIMEOUT_MS]);
    });

    it('gives a provider at least the shortest window it names, however short the caller asked', async () => {
      const { chosen, client } = world();
      Object.assign(chosen, { shortestReadWindowMs: 30_000 });

      await client.reader('player').readBytes(REFERENCE, { timeoutMs: 1_000 });
      await readBytes(client);

      expect(chosen.windows).toEqual([30_000, 30_000]);
    });
  });

  it("names the player a feature's own provider brings, with that provider's id, and none for one that brings none", async () => {
    const { chosen, client } = world();
    const second = new ScriptedProvider('second');
    const player = { attach: async () => undefined, detach: () => undefined };
    Object.assign(second, { ownPlayer: async () => player });
    const routed = new SwarmClient({
      chosen: { id: 'chosen', provider: chosen },
      routes: { player: { id: 'second', provider: second } },
    });

    expect(client.ownPlayer('player')).toBeNull();
    expect(routed.ownPlayer('stream-list')).toBeNull();
    const own = routed.ownPlayer('player');
    expect(own?.id).toBe('second');
    expect(await own?.load()).toBe(player);
    expect(own?.status()).toEqual({ state: 'ready' });

    const release = own!.hold();
    release();
    release();
    expect([second.started, second.stopped]).toEqual([1, 1]);
    expect(routed.ownPlayer('player'), 'the same handle each time, so a page polling its status keeps one timer').toBe(
      own,
    );
  });

  it('says where the chosen provider is in its own life', () => {
    const { client } = world();

    expect(client.status()).toEqual({ state: 'ready' });
  });

  it('counts every read by feature, kind of read, provider and answer', async () => {
    const { chosen, other, client } = world();
    chosen.answer = content();
    await client.reader('player').readFeedEntry(OWNER, TOPIC, 1);
    await client.reader('player').readFeedEntry(OWNER, TOPIC, 2);
    chosen.answer = fault;
    other.answer = notFound;
    await client.reader('stream-list').readFeedHead(OWNER, TOPIC);
    await client.reader('chat').readFeedHead(OWNER, TOPIC);

    expect(client.counts()).toEqual([
      { feature: 'player', read: 'feed-entry', provider: 'chosen', answer: 'content', count: 2 },
      { feature: 'stream-list', read: 'feed-head', provider: 'chosen', answer: 'unavailable', count: 1 },
      { feature: 'chat', read: 'feed-head', provider: 'other', answer: 'not-found', count: 1 },
    ]);
  });

  describe('what answered in the last minute', () => {
    it('gives each feature its provider and its answers by provider and kind', async () => {
      const { chosen, other, client } = world();
      chosen.answer = content();
      await client.reader('player').readFeedEntry(OWNER, TOPIC, 1);
      await client.reader('player').readFeedEntry(OWNER, TOPIC, 2);
      chosen.answer = fault;
      await client.reader('stream-list').readFeedHead(OWNER, TOPIC);
      other.answer = notFound;
      await client.reader('chat').readChunk(REFERENCE);

      expect(client.activity()).toEqual([
        { feature: 'player', primary: 'chosen', answers: [{ provider: 'chosen', answer: 'content', count: 2 }] },
        {
          feature: 'stream-list',
          primary: 'chosen',
          answers: [{ provider: 'chosen', answer: 'unavailable', count: 1 }],
        },
        { feature: 'previews', primary: 'chosen', answers: [] },
        { feature: 'chat', primary: 'other', answers: [{ provider: 'other', answer: 'not-found', count: 1 }] },
      ]);
    });

    it('forgets reads older than a minute', async () => {
      const { chosen, client, advance } = world();
      chosen.answer = content();
      await client.reader('player').readFeedEntry(OWNER, TOPIC, 1);
      advance(30_000);
      await client.reader('player').readFeedEntry(OWNER, TOPIC, 2);
      advance(30_001);

      expect(client.activity().find(({ feature }) => feature === 'player')?.answers).toEqual([
        { provider: 'chosen', answer: 'content', count: 1 },
      ]);
    });
  });

  describe('the gateway clock', () => {
    it.each(['player', 'stream-list'] as const)(
      'learns the offset from the server time of a %s answer',
      async (feature) => {
        const gatewayMs = Date.UTC(2026, 9, 7, 12, 0, 30);
        const clock = new GatewayClock(() => gatewayMs - 60_000);
        const { chosen, client } = world({ clock });
        chosen.answer = { kind: 'not-found', serverTimeMs: gatewayMs };

        await client.reader(feature).readFeedEntry(OWNER, TOPIC, 9);

        expect(client.clockOffsetMs()).toBe(60_500);
      },
    );

    it.each(['chat', 'previews'] as const)(
      'is not moved by a %s answer, so only what the player and the stream list read sets it',
      async (feature) => {
        const gatewayMs = Date.UTC(2026, 9, 7, 12, 0, 30);
        const clock = new GatewayClock(() => gatewayMs - 60_000);
        const { chosen, other, client } = world({ clock });
        chosen.answer = { kind: 'not-found', serverTimeMs: gatewayMs };
        other.answer = chosen.answer;

        await client.reader(feature).readChunk(REFERENCE);

        expect(client.clockOffsetMs()).toBe(0);
      },
    );

    it('keeps the offset it had when an answer carries no server time', async () => {
      const gatewayMs = Date.UTC(2026, 9, 7, 12, 0, 30);
      const clock = new GatewayClock(() => gatewayMs + 2_000);
      const { chosen, client } = world({ clock });
      chosen.answer = content(gatewayMs);
      await readBytes(client);
      chosen.answer = content(null);
      await readBytes(client);

      expect(client.clockOffsetMs()).toBe(-1_500);
    });
  });

  describe('URLs the browser loads itself', () => {
    it("come from the feature's own provider, however its reads answer", async () => {
      const { chosen, client } = world();

      expect(client.reader('player').urlFor(REFERENCE, 'segment')).toBe(`chosen:segment:${REFERENCE}`);
      chosen.answer = fault;
      for (let read = 0; read < 5; read += 1) {
        await readBytes(client);
      }
      expect(client.reader('player').urlFor(REFERENCE, 'segment')).toBe(`chosen:segment:${REFERENCE}`);
      expect(client.reader('chat').urlFor(REFERENCE, 'segment')).toBe(`other:segment:${REFERENCE}`);
    });

    it('are null where the provider gives none, never taken from another', () => {
      const { chosen, client } = world();
      chosen.givesUrls = false;

      expect(client.reader('previews').urlFor(REFERENCE, 'thumbnail')).toBeNull();
    });
  });

  it('starts and stops every provider it holds, once each', async () => {
    const { chosen, other, client } = world();

    await client.start();
    await client.stop();

    for (const provider of [chosen, other]) {
      expect([provider.started, provider.stopped]).toEqual([1, 1]);
    }
  });
});

describe("the Swarm client's read of a single-owner chunk without its signature", () => {
  it('is offered only by a feature whose provider serves one, the node in this browser', () => {
    const weeb3 = new Weeb3Provider({
      runtime: {
        status: () => ({ state: 'stopped', peers: 0 }),
        acquire: async () => ({}) as never,
        release: () => undefined,
        whenReady: async () => ({}) as never,
      },
    });
    const client = new SwarmClient({
      chosen: { id: 'bee', provider: new BeeHttpProvider({ baseUrl: 'https://bee.example.com' }) },
      routes: { chat: { id: 'weeb-3', provider: weeb3 } },
    });

    expect(client.reader('chat').readUnsignedSoc).toBeTypeOf('function');
    expect(client.reader('player').readUnsignedSoc).toBeUndefined();
  });
});
