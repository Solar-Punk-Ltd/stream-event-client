import { FeedIndex, Topic } from '@ethersphere/bee-js';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CatalogFeedReader } from '../src/features/catalog/catalogFeed';
import { fetchPreviewManifest } from '../src/features/catalog/StreamPreview/previewManifest';
import { ManifestFetcher, ManifestStateManager } from '../src/features/player/ManifestManagement';
import { browserNodeFeeds } from '../src/shared/browserNodeFeeds';
import { RequestJitter } from '../src/shared/requestJitter';

/**
 * Every reader of a feed goes through `browserNodeFeeds` in production: the player, the catalog and
 * the stream cards. With the browser's node on and a provider present, none of them touches the
 * gateway, and with either missing all of them read the gateway as before.
 */

const GATEWAY = 'https://event-gateway.example';
const OWNER = '0x' + '1'.repeat(40);
const RUNG = 'wiring-rung';

const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

const realFetch = globalThis.fetch;
let gatewayUrls: string[];
let providerCalls: { method: string; params: Record<string, unknown> }[];

/** A publisher that has written slots 0 to 6 of every feed, as Freedom's provider answers for it. */
function installProvider(): void {
  (globalThis as { swarm?: unknown }).swarm = {
    request: async ({ method, params }: { method: string; params: Record<string, unknown> }) => {
      providerCalls.push({ method, params });
      const index = params.index as number | undefined;
      if (index !== undefined && index > 6) {
        throw Object.assign(new Error('not found'), { code: -32602, data: { reason: 'entry_not_found' } });
      }
      const body =
        params.topic === Topic.fromString('wiring-catalog').toString()
          ? JSON.stringify({ entries: [] })
          : ['#EXTM3U', '#EXT-X-TARGETDURATION:2', '#EXTINF:2,', `seg-${index ?? 6}.ts`].join('\n');
      return { data: base64(body), encoding: 'base64', index: index ?? 6, nextIndex: (index ?? 6) + 1 };
    },
  };
}

beforeEach(() => {
  gatewayUrls = [];
  providerCalls = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    gatewayUrls.push(String(input));
    return new Response('not found', { status: 404 });
  };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as { swarm?: unknown }).swarm;
  browserNodeFeeds.enabled = false;
  vi.restoreAllMocks();
});

async function followRungOnePoll(): Promise<void> {
  const manager = ManifestStateManager.getInstance();
  const hexTopic = Topic.fromString(RUNG).toString();
  manager.clear(hexTopic);
  manager.updateManifest(
    hexTopic,
    ['#EXTM3U'],
    [{ extinf: '#EXTINF:2,', uri: 'seg-4.ts', discontinuity: false }],
    false,
  );
  manager.setIndex(hexTopic, FeedIndex.fromBigInt(4n));
  const fetcher = new ManifestFetcher(manager, undefined, undefined, new RequestJitter(0, () => 0));
  fetcher.beeUrl = GATEWAY;
  await fetcher.fetch(`${OWNER}/${RUNG}`);
  for (let tick = 0; tick < 50; tick++) {
    await sleep(0);
  }
}

describe("with this browser's node on and a provider present", () => {
  beforeEach(() => {
    installProvider();
    browserNodeFeeds.enabled = true;
  });

  it('follows a live feed through the node, to the slot that is not there yet', async () => {
    await followRungOnePoll();

    expect(providerCalls.map((call) => call.params.index)).toEqual([5, 6, 7]);
    expect(gatewayUrls).toEqual([]);
  });

  it('reads the catalog head through the node and takes its slot from it', async () => {
    const reader = new CatalogFeedReader(OWNER.slice(2), Topic.fromString('wiring-catalog'));

    const snapshot = await reader.read(GATEWAY);

    expect(snapshot?.slot).toBe(6n);
    expect(reader.getIndex()?.toBigInt()).toBe(6n);
    expect(gatewayUrls).toEqual([]);
  });

  it("reads a finished stream card's playlist through the node", async () => {
    const { res, segments } = await fetchPreviewManifest(
      GATEWAY,
      { owner: OWNER.slice(2), topic: RUNG, index: 3, state: 'vod' },
      new AbortController().signal,
    );

    expect(res.status).toBe(200);
    expect(segments.map((segment) => segment.uri)).toEqual(['seg-3.ts']);
    expect(gatewayUrls).toEqual([]);
  });
});

describe('otherwise', () => {
  it('reads the gateway when the mode is off, even with a provider present', async () => {
    installProvider();

    await followRungOnePoll();

    expect(providerCalls).toEqual([]);
    expect(gatewayUrls.length).toBeGreaterThan(0);
    expect(gatewayUrls.every((url) => url.startsWith(`${GATEWAY}/soc/`))).toBe(true);
  });

  it('reads the gateway when the page has no provider, even with the mode on', async () => {
    browserNodeFeeds.enabled = true;

    await followRungOnePoll();

    expect(gatewayUrls.length).toBeGreaterThan(0);
  });
});
