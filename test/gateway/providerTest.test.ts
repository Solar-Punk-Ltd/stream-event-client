import { FeedIndex, Topic } from '@ethersphere/bee-js';
import { describe, expect, it } from 'vitest';

import { parseRuntimeConfig, type ChatConfig } from '../../src/config/runtimeConfig';
import type { Stream } from '../../src/features/catalog/stream';
import {
  CHAT_FEED_NOT_FOUND,
  COULD_NOT_REACH,
  MIXED_CONTENT,
  NOT_A_SWARM_GATEWAY,
  SKIPPED,
} from '../../src/features/gateway/checkSentences';
import { onlyGateway } from '../../src/features/gateway/gatewayProbe';
import { CHECKS, type CheckResult, testProvider } from '../../src/features/gateway/providerTest';
import { makeFeedIdentifier } from '../../src/shared/feedFollow';
import { encodeLadderMarker, ladderMarkerIdentifier, markerPeriodAt } from '../../src/shared/ladderMarker';
import { loadUrl } from '../../src/swarm/client';
import { createSwarmClient } from '../../src/swarm/createSwarmClient';
import { faultyFetch, RECORDED_GATEWAY, recordedCatalog, recordedFetch } from '../helpers/recordedBeeGateway';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const RECORDED_CHAT = (() => {
  const parsed = parseRuntimeConfig(JSON.parse(readFileSync(join(ROOT, 'e2e', 'recorded', 'config.json'), 'utf8')));
  if (!parsed.ok || !parsed.config.chat?.enabled) {
    throw new Error('the recorded config has no chat');
  }
  return parsed.config.chat as ChatConfig;
})();

const HEALTH = `${RECORDED_GATEWAY}/health`;

/** What one request is answered with: a response, a refusal as a browser reports one, or nothing. */
type Answer = Response | 'refuse' | 'hang';

/** The recording, with Bee's health answer added and any URL the test names answered its own way. */
function gateway(override: (url: string) => Answer | undefined = () => undefined): typeof fetch {
  const recorded = recordedFetch();
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const answer = override(url) ?? (url === HEALTH ? Response.json({ status: 'ok', version: '2.8.2' }) : undefined);
    if (answer === 'refuse') {
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    if (answer === 'hang') {
      return new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
      );
    }
    return answer ? Promise.resolve(answer) : recorded(input, init);
  }) as typeof fetch;
}

interface Run {
  readonly fetcher: typeof fetch;
  readonly chat?: ChatConfig | null;
  readonly knownStreams?: readonly Stream[];
  readonly catalog?: { owner: string; topic: string };
  readonly address?: string;
  readonly pageProtocol?: string;
  readonly now?: () => number;
}

async function run({
  fetcher,
  chat = RECORDED_CHAT,
  knownStreams = [],
  catalog = recordedCatalog(),
  address = RECORDED_GATEWAY,
  pageProtocol = 'http:',
  now,
}: Run): Promise<Record<string, CheckResult>> {
  const client = createSwarmClient(onlyGateway({ id: 'tested', kind: 'bee-http', url: address }), {
    environment: { fetcher, pageOrigin: 'http://127.0.0.1:4173' },
  });
  const results = await testProvider({
    client,
    address,
    catalog,
    knownStreams,
    chat,
    pageProtocol,
    now,
    loadUrl: (url, options) => loadUrl(url, { ...options, fetcher }),
  });
  expect(results.map(({ check }) => check)).toEqual([...CHECKS]);
  return Object.fromEntries(results.map((result) => [result.check, result]));
}

const RECORDED_TITLE = '“Recorded test pattern”';

describe("the control panel's Test, on the event's recorded content", () => {
  it('passes every feature the recording holds, and says what each loaded', async () => {
    const results = await run({ fetcher: gateway() });

    expect(results.connection).toEqual({
      check: 'connection',
      outcome: 'passed',
      sentence: expect.stringMatching(/^The gateway answered in \d+ ms\.$/),
    });
    expect(results['stream-list']).toEqual({
      check: 'stream-list',
      outcome: 'passed',
      sentence: 'The stream list loaded: 1 stream, entry 0.',
    });
    expect(results.player).toEqual({
      check: 'player',
      outcome: 'passed',
      sentence: `The video loaded: a playlist of ${RECORDED_TITLE} and one segment.`,
    });
    expect(results.previews).toEqual({
      check: 'previews',
      outcome: 'passed',
      sentence: `Previews loaded: the preview playlist of ${RECORDED_TITLE}.`,
    });
    expect(results.thumbnails).toEqual({ check: 'thumbnails', outcome: 'skipped', sentence: SKIPPED.noPicture });
    expect(results.chat).toEqual({
      check: 'chat',
      outcome: 'passed',
      sentence: `The chat loaded: the newest message of ${RECORDED_TITLE}.`,
    });
  });

  it('says a gateway that cannot be reached may be refusing this site, on every check', async () => {
    const results = await run({ fetcher: faultyFetch(), knownStreams: recordedStreams() });

    for (const check of CHECKS.filter((name) => name !== 'thumbnails')) {
      expect(results[check], check).toEqual({ check, outcome: 'failed', sentence: COULD_NOT_REACH });
    }
    expect(COULD_NOT_REACH).toContain('this node does not allow this site');
  });

  it('tests the other features on the list the page already shows when this gateway cannot read it', async () => {
    const results = await run({
      fetcher: gateway((url) => (url.includes('/feeds/dc014b8a') ? new Response('', { status: 404 }) : undefined)),
      knownStreams: recordedStreams(),
    });

    expect(results['stream-list'].outcome).toBe('failed');
    expect(results['stream-list'].sentence).toBe(
      'This gateway answered that the stream list is not there. It may not have found it on the network yet. Test again in a minute, or pick another gateway.',
    );
    expect(results.player.outcome).toBe('passed');
    expect(results.chat.outcome).toBe('passed');
  });

  it('says an address that answers with a web page is not a Swarm gateway', async () => {
    const page = () => new Response('<!doctype html><title>Some site</title>', { status: 200 });
    const results = await run({ fetcher: gateway(page), knownStreams: recordedStreams() });

    expect(results.connection.sentence).toBe(NOT_A_SWARM_GATEWAY);
    expect(results['stream-list'].sentence).toBe(NOT_A_SWARM_GATEWAY);
    expect(results.player.sentence).toBe(NOT_A_SWARM_GATEWAY);
    expect(NOT_A_SWARM_GATEWAY).toContain('This address is not a Swarm gateway');
  });

  it('names the status a failing gateway answered, and what to do', async () => {
    const results = await run({
      fetcher: gateway((url) => (url.includes('/bytes/') ? new Response('', { status: 502 }) : undefined)),
    });

    expect(results.player).toEqual({
      check: 'player',
      outcome: 'failed',
      sentence: 'The gateway answered with an error (HTTP 502). Test again in a minute, or pick another gateway.',
    });
    expect(results['stream-list'].outcome).toBe('passed');
  });

  it('says a gateway asked to be asked less often', async () => {
    const results = await run({
      fetcher: gateway((url) => (url.includes('/chunks/') ? new Response('', { status: 429 }) : undefined)),
    });

    expect(results.chat).toEqual({
      check: 'chat',
      outcome: 'failed',
      sentence: 'This gateway asked to be asked less often. Wait a minute, then test again.',
    });
  });

  it('does not pass the chat when this gateway cannot find its feed, and says why', async () => {
    // Nothing in the stream list says a stream has a chat, so a feed this gateway cannot find proves nothing.
    const results = await run({
      fetcher: gateway((url) => (url.includes('/feeds/c1ba847e') ? new Response('', { status: 404 }) : undefined)),
    });

    expect(results.chat).toEqual({
      check: 'chat',
      outcome: 'skipped',
      sentence: CHAT_FEED_NOT_FOUND(RECORDED_TITLE.slice(1, -1)),
    });
    expect(results.chat.sentence).toBe(
      `Not tested: this gateway found no chat feed for ${RECORDED_TITLE}. Nobody may have written in it yet, or the gateway has not found it on the network. Test again once the chat has messages.`,
    );
  });

  it('skips the chat on a site that has none, and every stream check on an empty list', async () => {
    const empty = gateway((url) => (url.includes('/feeds/dc014b8a') ? Response.json([]) : undefined));
    const results = await run({ fetcher: empty, chat: null });

    expect(results.chat).toEqual({ check: 'chat', outcome: 'skipped', sentence: SKIPPED.noChat });
    for (const check of ['player', 'previews', 'thumbnails'] as const) {
      expect(results[check]).toEqual({ check, outcome: 'skipped', sentence: SKIPPED.noStreams });
    }
  });

  it('refuses before asking anything when the browser would block a plain http gateway', async () => {
    const asked: string[] = [];
    const results = await run({
      fetcher: (async (input: RequestInfo | URL) => {
        asked.push(String(input));
        return new Response('');
      }) as typeof fetch,
      address: 'http://192.0.2.10:1633',
      pageProtocol: 'https:',
    });

    expect(Object.values(results).map(({ sentence }) => sentence)).toEqual(CHECKS.map(() => MIXED_CONTENT));
    expect(asked).toEqual([]);
  });
});

describe("the control panel's Test, on a live ladder and pictures", () => {
  const GW = 'https://gateway.example.com';
  const OWNER = 'a1'.repeat(20);
  const GROUP = 'test-ladder-master';
  const RUNG = 'test-ladder-240p';
  const PICTURE = 'cd'.repeat(32);
  const SEGMENT = 'ef'.repeat(32);
  const NOW = Date.UTC(2026, 10, 2, 10, 0, 5);
  const PERIOD = markerPeriodAt(NOW) - 1;
  const LIVE: Stream = {
    owner: OWNER,
    topic: GROUP,
    title: 'Main stage',
    timestamp: NOW - 60_000,
    mediatype: 'video',
    state: 'live',
    thumbnail: PICTURE,
    renditions: [{ name: '240p', topic: RUNG, width: 426, height: 240, bandwidth: 400_000, avgBandwidth: 350_000 }],
  };
  const markerPath = `${GW}/soc/${OWNER}/${ladderMarkerIdentifier(Topic.fromString(GROUP), PERIOD).toHex()}`;
  const rungEntry = (index: number) =>
    `${GW}/soc/${OWNER}/${makeFeedIdentifier(Topic.fromString(RUNG), FeedIndex.fromBigInt(BigInt(index))).toString()}`;
  const playlist = ['#EXTM3U', '#EXT-X-TARGETDURATION:2', '#EXTINF:2.0,', SEGMENT].join('\n');
  const marker = new TextDecoder().decode(
    encodeLadderMarker({
      v: 1,
      period: PERIOD,
      writtenAt: PERIOD * 10_000 + 250,
      rungs: { [Topic.fromString(RUNG).toHex()]: 42 },
    }),
  );

  function ladderGateway(pictureStatus: number): typeof fetch {
    return (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${GW}/health`) {
        return Response.json({ status: 'ok' });
      }
      if (url === markerPath) {
        return new Response(marker);
      }
      if (url === rungEntry(42)) {
        return new Response(playlist);
      }
      if (url === `${GW}/bytes/${SEGMENT}`) {
        return new Response(new Uint8Array([0x47]));
      }
      if (url === `${GW}/bzz/${PICTURE}/`) {
        return new Response(new Uint8Array([0x89]), { status: pictureStatus });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;
  }

  const runLadder = (pictureStatus: number) =>
    run({
      fetcher: ladderGateway(pictureStatus),
      address: GW,
      knownStreams: [LIVE],
      chat: null,
      now: () => NOW,
    });

  it("reads the video through the ladder's time marker, as the player starts", async () => {
    const results = await runLadder(200);

    expect(results.player).toEqual({
      check: 'player',
      outcome: 'passed',
      sentence: 'The video loaded: the time marker of “Main stage”, a playlist and one segment.',
    });
  });

  it("loads a stream's picture, and says when the gateway refused it", async () => {
    expect((await runLadder(200)).thumbnails).toEqual({
      check: 'thumbnails',
      outcome: 'passed',
      sentence: 'Pictures loaded: the picture of “Main stage”.',
    });
    expect((await runLadder(500)).thumbnails).toEqual({
      check: 'thumbnails',
      outcome: 'failed',
      sentence: 'The gateway answered with an error (HTTP 500). Test again in a minute, or pick another gateway.',
    });
  });
});

function recordedStreams(): Stream[] {
  return JSON.parse(
    readFileSync(join(ROOT, 'e2e', 'recorded', '3097357c1d783f7029ce55baf2cf022419041e6e.bin'), 'utf8'),
  ) as Stream[];
}
