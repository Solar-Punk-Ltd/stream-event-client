import { FeedIndex, Topic } from '@ethersphere/bee-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BrowserNodeFeeds, fetchFeed, NODE_RETRY_MS, type SwarmProvider } from '../src/shared/browserNodeFeeds';
import { feedSlotPath, makeFeedIdentifier, nextFeedRequest } from '../src/shared/feedFollow';
import { UNSERVED_POLLS_BEFORE_PROBE } from '../src/features/player/refusedSlot';

/**
 * Feed reads through Freedom's `window.swarm`, with the gateway behind them.
 *
 * The provider is a stand-in that answers the way Freedom's `swarm-provider-ipc.js` does: a result
 * object, or an `Error` carrying `code` and `data.reason`.
 */

const GATEWAY = 'https://event-gateway.example';
const OWNER = 'ab'.repeat(20);
const TOPIC = Topic.fromString('a-live-rung');

interface Call {
  method: string;
  params: Record<string, unknown>;
}

function providerError(code: number, reason?: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(reason ?? 'failed'), { code, data: reason ? { reason, ...extra } : undefined });
}

const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

class FakeProvider implements SwarmProvider {
  readonly calls: Call[] = [];
  answer: (call: Call) => Promise<unknown> = () => Promise.reject(new Error('unexpected request'));

  request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
    const call = { method, params: (params ?? {}) as Record<string, unknown> };
    this.calls.push(call);
    return this.answer(call);
  }
}

let provider: FakeProvider;
let clock: number;
let feeds: BrowserNodeFeeds;

beforeEach(() => {
  provider = new FakeProvider();
  clock = 1_000_000;
  feeds = new BrowserNodeFeeds(
    () => provider,
    () => clock,
    50,
  );
  feeds.enabled = true;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reading through the browser node', () => {
  it('reads a feed head as a feed entry and names its slot the way a gateway does', async () => {
    provider.answer = () =>
      Promise.resolve({ data: base64('#EXTM3U\nhead'), encoding: 'base64', index: 34, nextIndex: 35 });

    const response = await feeds.read(`${GATEWAY}/${nextFeedRequest(OWNER, TOPIC, null).path}`);

    expect(provider.calls).toEqual([
      { method: 'swarm_readFeedEntry', params: { topic: TOPIC.toString(), owner: OWNER } },
    ]);
    expect(response?.status).toBe(200);
    expect(response?.ok).toBe(true);
    expect(response?.text).toBe('#EXTM3U\nhead');
    // Hexadecimal and zero-padded, as `extractFeedIndex` reads it: 34 is 0x22.
    expect(response?.headers.get('swarm-feed-index')).toBe('0000000000000022');
  });

  // The only read on the node that joins a playlist larger than one chunk, as a finished one is.
  it('reads a slot it built by topic and index rather than as a bare chunk', async () => {
    provider.answer = () => Promise.resolve({ data: base64('slot 7'), encoding: 'base64', index: 7, nextIndex: 8 });

    const response = await feeds.read(`${GATEWAY}/${feedSlotPath(OWNER, TOPIC, FeedIndex.fromBigInt(7n))}`);

    expect(provider.calls).toEqual([
      { method: 'swarm_readFeedEntry', params: { topic: TOPIC.toString(), owner: OWNER, index: 7 } },
    ]);
    expect(response?.text).toBe('slot 7');
    expect(response?.headers.get('swarm-feed-index')).toBeNull();
  });

  it('reads a slot it did not build as a single-owner chunk when that is the whole content', async () => {
    const identifier = makeFeedIdentifier(Topic.fromString('never-built-here'), FeedIndex.fromBigInt(3n)).toString();
    provider.answer = () => Promise.resolve({ data: base64('small'), encoding: 'base64', span: 5 });

    const response = await feeds.read(`${GATEWAY}/soc/${OWNER}/${identifier}`);

    expect(provider.calls).toEqual([{ method: 'swarm_readSingleOwnerChunk', params: { owner: OWNER, identifier } }]);
    expect(response?.text).toBe('small');
  });

  it('leaves a chunk that is only the root of something larger to the gateway', async () => {
    const identifier = makeFeedIdentifier(Topic.fromString('never-built-either'), FeedIndex.fromBigInt(3n)).toString();
    provider.answer = () => Promise.resolve({ data: base64('refs'), encoding: 'base64', span: 300_000 });

    expect(await feeds.read(`${GATEWAY}/soc/${OWNER}/${identifier}`)).toBeNull();
  });

  // A follower at the live edge asks for the next slot before it exists, every poll.
  it('answers a slot that is not there yet as a gateway 404, and keeps reading through the node', async () => {
    provider.answer = () => Promise.reject(providerError(-32602, 'entry_not_found'));
    const slot9 = `${GATEWAY}/${feedSlotPath(OWNER, TOPIC, FeedIndex.fromBigInt(9n))}`;
    const slot10 = `${GATEWAY}/${feedSlotPath(OWNER, TOPIC, FeedIndex.fromBigInt(10n))}`;

    expect(await feeds.read(slot9)).toMatchObject({ ok: false, status: 404 });
    expect(await feeds.read(slot10)).toMatchObject({ ok: false, status: 404 });
    expect(provider.calls).toHaveLength(2);
  });

  it('sends the poll after a refusal to the gateway, and the one after that back to the node', async () => {
    provider.answer = () => Promise.reject(providerError(-32602, 'entry_not_found'));
    const path = `${GATEWAY}/${feedSlotPath(OWNER, TOPIC, FeedIndex.fromBigInt(9n))}`;

    expect(await feeds.read(path)).toMatchObject({ status: 404 });
    expect(await feeds.read(path)).toBeNull();
    expect(provider.calls).toHaveLength(1);

    provider.answer = () => Promise.resolve({ data: base64('slot 9'), encoding: 'base64', index: 9 });
    expect((await feeds.read(path))?.text).toBe('slot 9');
    expect(provider.calls).toHaveLength(2);
  });

  // Until the gateway is asked, a slot the node cannot retrieve looks to the player like one that is
  // not written, and the player probes past a slot left unserved for that many polls.
  it('asks the gateway about a refused slot before the player probes past it', async () => {
    provider.answer = () => Promise.reject(providerError(-32602, 'entry_not_found'));
    const path = `${GATEWAY}/${feedSlotPath(OWNER, TOPIC, FeedIndex.fromBigInt(9n))}`;

    let unserved = 0;
    while ((await feeds.read(path)) !== null) {
      unserved++;
    }
    expect(unserved).toBeLessThan(UNSERVED_POLLS_BEFORE_PROBE);
  });

  // The catalog reads its head every few seconds, and a believed not-found would read as no streams.
  it('asks the gateway about a feed head the node calls empty', async () => {
    provider.answer = () => Promise.reject(providerError(-32602, 'feed_empty'));

    expect(await feeds.read(`${GATEWAY}/${nextFeedRequest(OWNER, TOPIC, null).path}`)).toBeNull();
    expect(provider.calls).toHaveLength(1);
  });

  it('leaves anything that is not a feed read to the gateway', async () => {
    expect(await feeds.read(`${GATEWAY}/bytes/${'cd'.repeat(32)}`)).toBeNull();
    expect(await feeds.read(`${GATEWAY}/health`)).toBeNull();
    expect(provider.calls).toHaveLength(0);
  });
});

describe('when the browser node is not the place to read', () => {
  it('reads nothing through it while the mode is off', async () => {
    feeds.enabled = false;

    expect(await feeds.read(`${GATEWAY}/${nextFeedRequest(OWNER, TOPIC, null).path}`)).toBeNull();
    expect(provider.calls).toHaveLength(0);
  });

  it('reads nothing through it in a browser that gives the page no provider', async () => {
    const without = new BrowserNodeFeeds(() => null);
    without.enabled = true;

    expect(await without.read(`${GATEWAY}/${nextFeedRequest(OWNER, TOPIC, null).path}`)).toBeNull();
  });
});

describe("the browser's read budget", () => {
  const head = `${GATEWAY}/${nextFeedRequest(OWNER, TOPIC, null).path}`;

  // Freedom refuses every read after the one over the limit until its window is up.
  it('sends reads to the gateway for the window a refusal names, then tries the node again', async () => {
    provider.answer = () =>
      Promise.reject(providerError(-32602, 'rate_limited', { windowMs: 60_000, maxRequests: 120 }));

    expect(await feeds.read(head)).toBeNull();
    clock += 59_999;
    expect(await feeds.read(head)).toBeNull();
    expect(provider.calls).toHaveLength(1);

    provider.answer = () => Promise.resolve({ data: base64('back'), encoding: 'base64', index: 1 });
    clock += 1;
    expect((await feeds.read(head))?.text).toBe('back');
    expect(provider.calls).toHaveLength(2);
  });

  it('stops pausing once the viewer connects the site, which raises the budget', async () => {
    provider.answer = (call) =>
      call.method === 'swarm_requestAccess'
        ? Promise.resolve({ connected: true, origin: 'bzz://viewer', capabilities: ['publish'] })
        : Promise.reject(providerError(-32602, 'rate_limited', { windowMs: 60_000 }));
    await feeds.read(head);

    expect(await feeds.requestAccess()).toBe(true);

    provider.answer = () => Promise.resolve({ data: base64('more'), encoding: 'base64', index: 2 });
    expect((await feeds.read(head))?.text).toBe('more');
  });

  // Connecting raises the budget. It does nothing for a node that is failing.
  it('keeps a pause for a node that failed when the viewer connects the site', async () => {
    provider.answer = (call) =>
      call.method === 'swarm_requestAccess'
        ? Promise.resolve({ connected: true })
        : Promise.reject(providerError(4900, 'node-stopped'));
    expect(await feeds.read(head)).toBeNull();

    expect(await feeds.requestAccess()).toBe(true);
    expect(await feeds.read(head)).toBeNull();
    expect(provider.calls.map((call) => call.method)).toEqual(['swarm_readFeedEntry', 'swarm_requestAccess']);

    clock += NODE_RETRY_MS;
    await feeds.read(head);
    expect(provider.calls).toHaveLength(3);
  });

  it('keeps the pause when the viewer declines', async () => {
    provider.answer = () => Promise.reject(providerError(4001, undefined));

    expect(await feeds.requestAccess()).toBe(false);
  });

  it('tells a connected site from one that is not, without a prompt', async () => {
    provider.answer = () => Promise.resolve({ canPublish: false, reason: 'not-connected' });
    expect(await feeds.access()).toBe('not-connected');

    provider.answer = () => Promise.resolve({ canPublish: true, reason: null });
    expect(await feeds.access()).toBe('connected');

    expect(provider.calls.map((call) => call.method)).toEqual(['swarm_getCapabilities', 'swarm_getCapabilities']);
  });
});

describe('a node that cannot answer', () => {
  const head = `${GATEWAY}/${nextFeedRequest(OWNER, TOPIC, null).path}`;

  it('goes to the gateway for a while when the node is unavailable', async () => {
    provider.answer = () => Promise.reject(providerError(4900, 'node-stopped'));

    expect(await feeds.read(head)).toBeNull();
    clock += NODE_RETRY_MS - 1;
    expect(await feeds.read(head)).toBeNull();
    expect(provider.calls).toHaveLength(1);

    clock += 1;
    await feeds.read(head);
    expect(provider.calls).toHaveLength(2);
  });

  it('gives up on a read that outlasts a gateway read, and pauses', async () => {
    provider.answer = () => new Promise(() => {});

    expect(await feeds.read(head)).toBeNull();
    expect(await feeds.read(head)).toBeNull();
    expect(provider.calls).toHaveLength(1);
  });

  it('stops asking a provider that does not have these reads', async () => {
    provider.answer = () => Promise.reject(providerError(4200));

    expect(await feeds.read(head)).toBeNull();
    clock += 10 * NODE_RETRY_MS;
    expect(await feeds.read(head)).toBeNull();
    expect(provider.calls).toHaveLength(1);
  });

  it("hands the caller's own cancellation back rather than reading from the gateway", async () => {
    provider.answer = () => new Promise(() => {});
    const abort = new AbortController();
    const read = feeds.read(head, abort.signal);
    abort.abort(new Error('unmounted'));

    await expect(read).rejects.toThrow('unmounted');
  });
});

describe('fetchFeed', () => {
  const head = `${GATEWAY}/${nextFeedRequest(OWNER, TOPIC, null).path}`;
  const gatewayAnswer = vi.fn(
    async (_url: string | URL | Request) => new Response('from the gateway', { status: 200 }),
  );

  beforeEach(() => {
    gatewayAnswer.mockClear();
  });

  it('takes the answer from the node when it has one', async () => {
    provider.answer = () => Promise.resolve({ data: base64('from the node'), encoding: 'base64', index: 0 });

    const response = await fetchFeed(head, { fetcher: gatewayAnswer as typeof fetch }, feeds);

    expect(response.text).toBe('from the node');
    expect(gatewayAnswer).not.toHaveBeenCalled();
  });

  // A node takes about two seconds to give up on a slot, which is most of the time between polls.
  it('never spends a node miss and a gateway read on the same poll at the live edge', async () => {
    provider.answer = () => {
      clock += 1_800;
      return Promise.reject(providerError(-32602, 'entry_not_found'));
    };
    const slot = `${GATEWAY}/${feedSlotPath(OWNER, TOPIC, FeedIndex.fromBigInt(9n))}`;
    const missing = vi.fn(async () => new Response('', { status: 404 }));

    for (let poll = 0; poll < 6; poll++) {
      const reads = provider.calls.length + missing.mock.calls.length;
      expect((await fetchFeed(slot, { fetcher: missing as typeof fetch }, feeds)).status).toBe(404);
      expect(provider.calls.length + missing.mock.calls.length).toBe(reads + 1);
      clock += 750;
    }
    expect(provider.calls).toHaveLength(3);
    expect(missing).toHaveBeenCalledTimes(3);
  });

  // The R3 case: Freedom maps the node's Bee 500 to entry_not_found while the gateway has the slot.
  it('serves a slot the node cannot retrieve from the gateway on the next poll', async () => {
    provider.answer = () => Promise.reject(providerError(-32602, 'entry_not_found'));
    const slot = `${GATEWAY}/${feedSlotPath(OWNER, TOPIC, FeedIndex.fromBigInt(9n))}`;
    const fetcher = { fetcher: gatewayAnswer as typeof fetch };

    expect((await fetchFeed(slot, fetcher, feeds)).status).toBe(404);
    expect((await fetchFeed(slot, fetcher, feeds)).text).toBe('from the gateway');
    expect(provider.calls).toHaveLength(1);
    expect(gatewayAnswer).toHaveBeenCalledTimes(1);
  });

  // A slot written while the node was still looking for it, which at the live edge is ordinary.
  it('keeps reading a feed through the node when the gateway serves one slot it refused', async () => {
    const slotAt = (i: bigint) => `${GATEWAY}/${feedSlotPath(OWNER, TOPIC, FeedIndex.fromBigInt(i))}`;
    let written = 8n;
    provider.answer = () => Promise.reject(providerError(-32602, 'entry_not_found'));
    const gateway = vi.fn(async (url: string | URL | Request) =>
      [9n, 10n, 11n].some((i) => i <= written && url === slotAt(i))
        ? new Response('from the gateway', { status: 200 })
        : new Response('', { status: 404 }),
    );
    const fetcher = { fetcher: gateway as typeof fetch };

    // Each slot is refused by the node, written, and then served by the gateway, at the next slot
    // the gateway answers 404 first: the follower waits at the edge.
    for (const index of [9n, 10n, 11n]) {
      expect((await fetchFeed(slotAt(index), fetcher, feeds)).status).toBe(404);
      expect((await fetchFeed(slotAt(index), fetcher, feeds)).status).toBe(404);
      written = index;
      expect((await fetchFeed(slotAt(index), fetcher, feeds)).status).toBe(404);
      expect((await fetchFeed(slotAt(index), fetcher, feeds)).text).toBe('from the gateway');
    }
    expect(provider.calls).toHaveLength(6);
    expect(gateway).toHaveBeenCalledTimes(6);
  });

  // The R5 case: segments about as long as a node miss, so the node's lookup of each next slot starts
  // before the slot is written. Every slot then comes from the gateway, and the node is still asked
  // first for the next one rather than given up on for the feed.
  it('asks the node first for every new slot, even when the gateway served each slot before', async () => {
    provider.answer = () => Promise.reject(providerError(-32602, 'entry_not_found'));
    const slotAt = (i: bigint) => `${GATEWAY}/${feedSlotPath(OWNER, TOPIC, FeedIndex.fromBigInt(i))}`;
    const fetcher = { fetcher: gatewayAnswer as typeof fetch };

    for (let index = 9n; index < 15n; index++) {
      const nodeReads = provider.calls.length;
      expect((await fetchFeed(slotAt(index), fetcher, feeds)).status).toBe(404);
      expect(provider.calls).toHaveLength(nodeReads + 1);
      expect((await fetchFeed(slotAt(index), fetcher, feeds)).text).toBe('from the gateway');
      expect(provider.calls).toHaveLength(nodeReads + 1);
    }
  });

  it('passes on the 5xx the gateway gives for a slot the node refused', async () => {
    provider.answer = () => Promise.reject(providerError(-32602, 'entry_not_found'));
    const slot = `${GATEWAY}/${feedSlotPath(OWNER, TOPIC, FeedIndex.fromBigInt(9n))}`;
    const failing = vi.fn(async () => new Response('read chunk failed', { status: 500 }));

    expect((await fetchFeed(slot, { fetcher: failing as typeof fetch }, feeds)).status).toBe(404);
    expect((await fetchFeed(slot, { fetcher: failing as typeof fetch }, feeds)).status).toBe(500);
    expect(failing).toHaveBeenCalledTimes(1);
  });

  // A stream that has not started yet: the catalog polls its head every few seconds.
  it('reads a head the gateway agrees is empty from the gateway alone, until it is not', async () => {
    provider.answer = () => Promise.reject(providerError(-32602, 'feed_empty'));
    const missing = { fetcher: vi.fn(async () => new Response('', { status: 404 })) as typeof fetch };

    for (let poll = 0; poll < 4; poll++) {
      expect((await fetchFeed(head, missing, feeds)).status).toBe(404);
    }
    expect(provider.calls).toHaveLength(1);
    expect(missing.fetcher).toHaveBeenCalledTimes(4);

    expect((await fetchFeed(head, { fetcher: gatewayAnswer as typeof fetch }, feeds)).text).toBe('from the gateway');
    provider.answer = () => Promise.resolve({ data: base64('started'), encoding: 'base64', index: 0 });
    expect((await fetchFeed(head, { fetcher: gatewayAnswer as typeof fetch }, feeds)).text).toBe('started');
    expect(provider.calls).toHaveLength(2);
  });

  describe('a read larger than the byte budget', () => {
    const MAX_BYTES = 512 * 1024;
    const finished = new Response('#EXTM3U\n' + 'x'.repeat(MAX_BYTES), { status: 200 });
    const other = `${GATEWAY}/${nextFeedRequest(OWNER, Topic.fromString('another-rung'), null).path}`;

    beforeEach(() => {
      provider.answer = (call) =>
        call.method === 'swarm_requestAccess'
          ? Promise.resolve({ connected: true })
          : Promise.reject(providerError(-32602, 'rate_limited', { windowMs: 60_000, maxBytes: MAX_BYTES }));
    });

    it('goes straight to the gateway once the gateway shows it is over the budget', async () => {
      const gateway = vi.fn(async () => finished.clone());

      await fetchFeed(head, { fetcher: gateway as typeof fetch }, feeds);
      clock += 60_000;
      const again = await fetchFeed(head, { fetcher: gateway as typeof fetch }, feeds);

      expect(again.text.length).toBeGreaterThan(MAX_BYTES);
      expect(provider.calls).toHaveLength(1);
      expect(gateway).toHaveBeenCalledTimes(2);

      // Every other read still goes to the node.
      provider.answer = () => Promise.resolve({ data: base64('small'), encoding: 'base64', index: 0 });
      expect((await fetchFeed(other, { fetcher: gateway as typeof fetch }, feeds)).text).toBe('small');
    });

    it('tries the node again for it once the viewer connects the site', async () => {
      const gateway = vi.fn(async () => finished.clone());
      await fetchFeed(head, { fetcher: gateway as typeof fetch }, feeds);

      expect(await feeds.requestAccess()).toBe(true);
      provider.answer = () => Promise.resolve({ data: base64('joined'), encoding: 'base64', index: 0 });
      expect((await fetchFeed(head, { fetcher: gateway as typeof fetch }, feeds)).text).toBe('joined');
    });

    it('keeps reading through the node when the refusal was about the count, not the size', async () => {
      await fetchFeed(head, { fetcher: gatewayAnswer as typeof fetch }, feeds);
      clock += 60_000;
      provider.answer = () => Promise.resolve({ data: base64('back'), encoding: 'base64', index: 0 });

      expect((await fetchFeed(head, { fetcher: gatewayAnswer as typeof fetch }, feeds)).text).toBe('back');
    });
  });

  it('reads the same URL from the gateway when the node has none', async () => {
    provider.answer = () => Promise.reject(providerError(-32602, 'rate_limited', { windowMs: 60_000 }));

    const response = await fetchFeed(head, { fetcher: gatewayAnswer as typeof fetch }, feeds);

    expect(response.text).toBe('from the gateway');
    expect(gatewayAnswer).toHaveBeenCalledWith(head, expect.anything());
  });
});
