import { FeedIndex, Topic } from '@ethersphere/bee-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { feedSlotPath, makeFeedIdentifier, nextFeedRequest } from '../../src/shared/feedFollow';
import { BeeHttpProvider } from '../../src/swarm/providers/bee-http/beeHttpProvider';
import {
  answeringFetch,
  type AskedLog,
  faultyFetch,
  firstRecordedPath,
  RECORDED_GATEWAY,
  recordedBody,
  recordedCatalog,
  recordedFetch,
  recordedStream,
  silentFetch,
} from '../helpers/recordedBeeGateway';
import { type ContractHarness, describeProviderContract } from './providerContract';

const CATALOG = recordedCatalog();
const CATALOG_TOPIC = Topic.fromString(CATALOG.topic);
const STREAM = recordedStream();
const STREAM_TOPIC = Topic.fromString(STREAM.topic);
/** One of the chat's slots, which the recording read as a chunk. */
const CHAT_CHUNK = firstRecordedPath('chunks').slice('chunks/'.length);
/** The first segment the recording read. */
const SEGMENT = firstRecordedPath('bytes').slice('bytes/'.length);
/** The identifier of the recorded stream's first entry, a single-owner chunk the recording read. */
const FIRST_ENTRY_ID = makeFeedIdentifier(STREAM_TOPIC, FeedIndex.fromBigInt(0n)).toString();
/** The `Date` the recorded stream list head carries, Wed, 30 Sep 2026 07:16:57 GMT. */
const CATALOG_HEAD_DATE_MS = Date.UTC(2026, 8, 30, 7, 16, 57);

const RETRY_AFTER_SECONDS = 3;

const PAGE_ORIGIN = 'http://127.0.0.1:4173';

/** Obviously made up, so nothing a test names as absent can be stored anywhere. */
const ABSENT_ADDRESS = 'ab'.repeat(32);
const ABSENT_REFERENCE = 'cd'.repeat(32);

const urlOf = (path: string) => `${RECORDED_GATEWAY}/${path}`;

function beeHarness(): ContractHarness {
  return {
    world: {
      feedHead: {
        owner: CATALOG.owner,
        topic: CATALOG_TOPIC,
        index: 0,
        bytes: recordedBody(urlOf(nextFeedRequest(CATALOG.owner, CATALOG_TOPIC, null).path)),
        serverTimeMs: CATALOG_HEAD_DATE_MS,
      },
      feedEntry: {
        owner: STREAM.owner,
        topic: STREAM_TOPIC,
        index: 0,
        bytes: recordedBody(urlOf(feedSlotPath(STREAM.owner, STREAM_TOPIC, FeedIndex.fromBigInt(0n)))),
      },
      soc: {
        owner: STREAM.owner,
        identifier: FIRST_ENTRY_ID,
        bytes: recordedBody(urlOf(`soc/${STREAM.owner}/${FIRST_ENTRY_ID}`)),
      },
      chunk: { address: CHAT_CHUNK, bytes: recordedBody(urlOf(`chunks/${CHAT_CHUNK}`)) },
      bytes: { reference: SEGMENT, bytes: recordedBody(urlOf(`bytes/${SEGMENT}`)) },
      absent: {
        owner: CATALOG.owner,
        topic: Topic.fromString('nothing-was-published-here'),
        index: 7,
        identifier: ABSENT_REFERENCE,
        address: ABSENT_ADDRESS,
        reference: ABSENT_REFERENCE,
      },
    },
    retryAfterMs: RETRY_AFTER_SECONDS * 1000,
    provider: (behaviour) => {
      const fetcher = {
        served: () => recordedFetch(),
        silent: () => silentFetch(),
        faulty: () => faultyFetch(),
        'rate-limited': () => answeringFetch(429, { 'retry-after': String(RETRY_AFTER_SECONDS) }),
      }[behaviour]();
      return new BeeHttpProvider({ baseUrl: RECORDED_GATEWAY, fetcher, pageOrigin: PAGE_ORIGIN });
    },
  };
}

describeProviderContract('Bee over HTTP', beeHarness);

function provider(fetcher: typeof fetch, baseUrl = RECORDED_GATEWAY): BeeHttpProvider {
  return new BeeHttpProvider({ baseUrl, fetcher, pageOrigin: PAGE_ORIGIN });
}

describe('the Bee HTTP provider', () => {
  it('asks the same paths the app asks today, so the recorded replay still matches', async () => {
    const log: AskedLog = { urls: [] };
    const bee = provider(recordedFetch(log));

    await bee.readFeedHead(CATALOG.owner, CATALOG_TOPIC);
    await bee.readFeedEntry(STREAM.owner, STREAM_TOPIC, 3);
    await bee.readSoc(STREAM.owner, FIRST_ENTRY_ID);
    await bee.readChunk(CHAT_CHUNK);
    await bee.readBytes(SEGMENT);

    expect(log.urls).toEqual([
      urlOf(nextFeedRequest(CATALOG.owner, CATALOG_TOPIC, null).path),
      urlOf(feedSlotPath(STREAM.owner, STREAM_TOPIC, FeedIndex.fromBigInt(3n))),
      urlOf(`soc/${STREAM.owner}/${FIRST_ENTRY_ID}`),
      urlOf(`chunks/${CHAT_CHUNK}`),
      urlOf(`bytes/${SEGMENT}`),
    ]);
  });

  it('reads a gateway on this site, such as /bee, as a path on the page', async () => {
    const log: AskedLog = { urls: [] };

    await provider(recordedFetch(log), '/bee').readBytes(SEGMENT);

    expect(log.urls).toEqual([`/bee/bytes/${SEGMENT}`]);
  });

  it('takes a 500 as a fault of the node, not as content that is missing', async () => {
    const answer = await provider(answeringFetch(500, {}, '{"code":500,"message":"read chunk failed"}')).readChunk(
      CHAT_CHUNK,
    );

    expect(answer).toEqual({ kind: 'unavailable', cause: { kind: 'status', status: 500 } });
  });

  it("reads a Retry-After given as a date against the answer's own clock", async () => {
    const date = new Date(CATALOG_HEAD_DATE_MS).toUTCString();
    const later = new Date(CATALOG_HEAD_DATE_MS + 7_000).toUTCString();

    const answer = await provider(answeringFetch(429, { date, 'retry-after': later })).readBytes(SEGMENT);

    expect(answer).toEqual({ kind: 'rate-limited', retryAfterMs: 7_000, serverTimeMs: CATALOG_HEAD_DATE_MS });
  });

  it('answers rate limited with no wait when Retry-After is missing or unreadable', async () => {
    for (const headers of [{}, { 'retry-after': 'soon' }]) {
      const answer = await provider(answeringFetch(429, headers)).readBytes(SEGMENT);

      expect(answer).toMatchObject({ kind: 'rate-limited', retryAfterMs: null });
    }
  });

  it('gives a feed index only when the answer carries one', async () => {
    const answer = await provider(recordedFetch()).readBytes(SEGMENT);

    expect(answer).toMatchObject({ kind: 'content', feedIndex: null });
  });

  it('gives segment URLs as absolute addresses under /bytes, as the playlist lines carry them', () => {
    const bee = provider(recordedFetch(), '/bee/');

    expect(bee.urlFor(SEGMENT, 'segment')).toBe(`${PAGE_ORIGIN}/bee/bytes/${SEGMENT}`);
    expect(bee.urlFor(SEGMENT, 'preview-segment')).toBe(`${PAGE_ORIGIN}/bee/bytes/${SEGMENT}`);
  });

  it('gives an absolute gateway its own segment URLs, with any run of trailing slashes dropped', () => {
    // A rooted path resolved against the playlist's own swarm:// URL would keep the owner as a host,
    // and a doubled slash before bytes would read as a host called bytes.
    expect(provider(recordedFetch(), 'https://gateway.example//').urlFor(SEGMENT, 'segment')).toBe(
      `https://gateway.example/bytes/${SEGMENT}`,
    );
    expect(provider(recordedFetch(), '/bee///').urlFor(SEGMENT, 'segment')).toBe(`${PAGE_ORIGIN}/bee/bytes/${SEGMENT}`);
  });

  it('gives a picture URL under /bzz with the reference encoded and the trailing slash', () => {
    const bee = provider(recordedFetch(), '/bee');

    expect(bee.urlFor(` ${SEGMENT} `, 'thumbnail')).toBe(`/bee/bzz/${SEGMENT}/`);
    expect(bee.urlFor('../x?y', 'thumbnail')).toBe('/bee/bzz/..%2Fx%3Fy/');
  });

  it('can make every read, gives URLs and runs no node in the tab', () => {
    expect(provider(recordedFetch()).capabilities).toEqual({
      feedHead: true,
      feedEntry: true,
      soc: true,
      chunk: true,
      bytes: true,
      urls: true,
      inTab: false,
    });
  });

  it('is ready from the start, and starting and stopping it changes nothing', async () => {
    const bee = provider(recordedFetch());

    expect(bee.status()).toEqual({ state: 'ready' });
    await bee.start();
    await bee.stop();
    expect(bee.status()).toEqual({ state: 'ready' });
  });

  describe('with no fetcher injected', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    it('reads through the global fetch, called bare as the browser requires', async () => {
      const global = vi.fn(function (this: unknown) {
        expect(this).toBeUndefined();
        return Promise.resolve(new Response(new Uint8Array([9])));
      });
      globalThis.fetch = global as unknown as typeof fetch;

      const answer = await new BeeHttpProvider({ baseUrl: '/bee', pageOrigin: PAGE_ORIGIN }).readBytes(SEGMENT);

      expect(global).toHaveBeenCalledTimes(1);
      expect(answer).toMatchObject({ kind: 'content', bytes: new Uint8Array([9]) });
    });
  });

  describe('probing the node', () => {
    it('is ok when /health answers as Bee does', async () => {
      const log: AskedLog = { urls: [] };
      const fetcher = (async (input: RequestInfo | URL) => {
        log.urls.push(String(input));
        return new Response('{"status":"ok","version":"2.8.2"}');
      }) as typeof fetch;

      expect(await provider(fetcher).probe()).toMatchObject({ kind: 'ok' });
      expect(log.urls).toEqual([`${RECORDED_GATEWAY}/health`]);
    });

    it('tells a refusal, something that is not Bee, silence and no answer apart', async () => {
      expect(await provider(answeringFetch(403)).probe()).toEqual({ kind: 'rejected', status: 403 });
      expect(await provider(answeringFetch(200, {}, '<html>')).probe()).toEqual({ kind: 'not-swarm' });
      expect(await provider(silentFetch()).probe({ timeoutMs: 20 })).toEqual({ kind: 'timed-out' });
      expect(await provider(faultyFetch()).probe()).toEqual({ kind: 'unreachable' });
    });
  });
});
