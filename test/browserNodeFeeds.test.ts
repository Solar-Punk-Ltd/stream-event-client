import { FeedIndex, Topic } from '@ethersphere/bee-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BrowserNodeFeeds, fetchFeed, NODE_RETRY_MS, type SwarmProvider } from '../src/shared/browserNodeFeeds';
import { feedSlotPath, makeFeedIdentifier, nextFeedRequest } from '../src/shared/feedFollow';

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
    const path = `${GATEWAY}/${feedSlotPath(OWNER, TOPIC, FeedIndex.fromBigInt(9n))}`;

    const first = await feeds.read(path);
    const second = await feeds.read(path);

    expect(first).toMatchObject({ ok: false, status: 404 });
    expect(second).toMatchObject({ ok: false, status: 404 });
    expect(provider.calls).toHaveLength(2);
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
    expect(feeds.isActive()).toBe(false);
  });

  it('reads nothing through it in a browser that gives the page no provider', async () => {
    const without = new BrowserNodeFeeds(() => null);
    without.enabled = true;

    expect(await without.read(`${GATEWAY}/${nextFeedRequest(OWNER, TOPIC, null).path}`)).toBeNull();
    expect(without.isActive()).toBe(false);
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
    expect(feeds.isActive()).toBe(false);
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

  it('reads the same URL from the gateway when the node has none', async () => {
    provider.answer = () => Promise.reject(providerError(-32602, 'rate_limited', { windowMs: 60_000 }));

    const response = await fetchFeed(head, { fetcher: gatewayAnswer as typeof fetch }, feeds);

    expect(response.text).toBe('from the gateway');
    expect(gatewayAnswer).toHaveBeenCalledWith(head, expect.anything());
  });
});
