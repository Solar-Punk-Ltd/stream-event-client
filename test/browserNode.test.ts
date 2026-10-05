import { FeedIndex, Topic } from '@ethersphere/bee-js';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'vitest';

import { BROWSER_NODE_BYTES, browserNodeSegmentUrl, isServedOverBzz } from '../src/features/player/browserNode';
import { ManifestFetcher, ManifestStateManager } from '../src/features/player/ManifestManagement';
import { RequestJitter } from '../src/shared/requestJitter';

/**
 * Segments from the Swarm node of the browser that loaded the page, which Freedom serves at
 * `bzz://<ref>/`.
 *
 * A page Freedom loaded from Swarm cannot reach that node's HTTP port, so a `bzz://` URL is the only
 * way the video can come from it. Its node answers a reference that is not a manifest with the raw
 * bytes, which is what a segment is, and cannot answer a feed, so feeds stay on the gateway.
 */

const REF = 'a'.repeat(64);
const ENCRYPTED_REF = 'b'.repeat(128);

describe('which page is offered the browser node', () => {
  it('is a page loaded over bzz', () => {
    assert.equal(isServedOverBzz('bzz:'), true);
  });

  it.each(['http:', 'https:', 'file:', ''])('is not a page loaded over %j', (protocol) => {
    assert.equal(isServedOverBzz(protocol), false);
  });
});

describe('a segment URI as the browser node serves it', () => {
  it('serves a bare reference, which is what the uploader writes', () => {
    assert.equal(browserNodeSegmentUrl(REF), `bzz://${REF}/`);
  });

  it('serves an encrypted reference, which is twice as long', () => {
    assert.equal(browserNodeSegmentUrl(ENCRYPTED_REF), `bzz://${ENCRYPTED_REF}/`);
  });

  /**
   * A recording made before 2026-08-13 names its segments with the publisher's gateway in front. The
   * reference is still in there, so the browser's node can serve them like any other.
   */
  it.each([
    ['an absolute http', `http://publisher-gateway:1633/bytes/${REF}`],
    ['an absolute https', `https://publisher-gateway/bytes/${REF}`],
    ['a rooted', `/bytes/${REF}`],
    ['a proxied', `https://publisher-gateway/bee/bytes/${REF}`],
  ])('serves %s legacy URI from its reference', (_shape, uri) => {
    assert.equal(browserNodeSegmentUrl(uri), `bzz://${REF}/`);
  });

  it.each([
    ['a gap token', 'gap-1'],
    ['a file name', 'seg-5.ts'],
    ['a reference one character short', REF.slice(1)],
    ['a reference that is not hex', 'g'.repeat(64)],
    ['a bytes path with more after the reference', `/bytes/${REF}/extra`],
  ])('names nothing for %s, since there is no reference to serve', (_shape, uri) => {
    assert.equal(browserNodeSegmentUrl(uri), null);
  });
});

describe('a playlist serialized for the browser node', () => {
  const TOPIC = 'browser-node-serialize';
  const GATEWAY = 'http://127.0.0.1:1633/bytes';
  const LEGACY = `https://publisher-gateway/bytes/${ENCRYPTED_REF}`;
  const manager = ManifestStateManager.getInstance();

  beforeEach(() => {
    manager.clear(TOPIC);
    manager.updateManifest(
      TOPIC,
      ['#EXTM3U'],
      [
        { extinf: '#EXTINF:2,', uri: REF },
        { extinf: '#EXTINF:2,', uri: 'gap-1', gap: true },
        { extinf: '#EXTINF:2,', uri: LEGACY },
      ],
      false,
    );
  });

  function mediaLines(playlist: string): string[] {
    return playlist.split('\n').filter((line) => line && !line.startsWith('#'));
  }

  it('names every segment by bzz URL, the legacy one included, and leaves a gap alone', () => {
    assert.deepEqual(mediaLines(manager.serialize(TOPIC, BROWSER_NODE_BYTES)), [
      `bzz://${REF}/`,
      'gap-1',
      `bzz://${ENCRYPTED_REF}/`,
    ]);
  });

  it('re-serializes on a switch to the browser node and back, though nothing marked it dirty', () => {
    const before = manager.serialize(TOPIC, GATEWAY);
    const onBrowserNode = manager.serialize(TOPIC, BROWSER_NODE_BYTES);
    const after = manager.serialize(TOPIC, GATEWAY);

    assert.deepEqual(mediaLines(before), [`${GATEWAY}/${REF}`, 'gap-1', LEGACY]);
    assert.deepEqual(mediaLines(onBrowserNode), [`bzz://${REF}/`, 'gap-1', `bzz://${ENCRYPTED_REF}/`]);
    assert.equal(after, before, `switching back kept the browser node's playlist:\n${after}`);
  });
});

/**
 * That the switch on the fetcher moves the segments and nothing else. Freedom cannot serve a feed or
 * a single-owner chunk over `bzz://`, so a fetcher that followed the segments there with its feed
 * reads would stop at the first poll.
 */
describe('the fetcher with segments on the browser node', () => {
  const BEE_URL = 'https://event-gateway.test';
  const OWNER = '0x1111111111111111111111111111111111111111';
  const TOPIC_NAME = 'browser-node-fetcher';
  const hexTopic = Topic.fromString(TOPIC_NAME).toString();
  const manager = ManifestStateManager.getInstance();
  const realFetch = globalThis.fetch;
  let requested: string[];
  let fetcher: ManifestFetcher;

  beforeEach(() => {
    manager.clear(hexTopic);
    manager.updateManifest(hexTopic, ['#EXTM3U'], [{ extinf: '#EXTINF:2,', uri: REF }], false);
    manager.setIndex(hexTopic, FeedIndex.fromBigInt(5n));

    requested = [];
    // Every follow-up slot is one the publisher has not written yet, the ordinary answer at the live edge.
    globalThis.fetch = async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response('not found', { status: 404 });
    };
    fetcher = new ManifestFetcher(manager, undefined, undefined, new RequestJitter(0, () => 0));
    fetcher.beeUrl = BEE_URL;
  });

  afterEach(async () => {
    await fetcher.settled();
    globalThis.fetch = realFetch;
    manager.clear(hexTopic);
  });

  it('names segments on the gateway until it is switched, then on the browser node', async () => {
    const onGateway = await fetcher.fetch(`${OWNER}/${TOPIC_NAME}`);
    fetcher.segmentsFromBrowserNode = true;
    const onBrowserNode = await fetcher.fetch(`${OWNER}/${TOPIC_NAME}`);

    assert.match(onGateway, new RegExp(`^${BEE_URL}/bytes/${REF}$`, 'm'));
    assert.match(onBrowserNode, new RegExp(`^bzz://${REF}/$`, 'm'));
    assert.doesNotMatch(onBrowserNode, /event-gateway/);
  });

  it('keeps reading the feed from the gateway', async () => {
    fetcher.segmentsFromBrowserNode = true;

    await fetcher.fetch(`${OWNER}/${TOPIC_NAME}`);
    await fetcher.settled();

    assert.ok(requested.length > 0, 'no feed read was issued, so this test asserted nothing');
    for (const url of requested) {
      assert.ok(url.startsWith(`${BEE_URL}/`), `a feed read left the gateway: ${url}`);
    }
  });
});
