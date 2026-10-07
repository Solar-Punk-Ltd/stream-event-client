import { FeedIndex, Topic } from '@ethersphere/bee-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseRuntimeConfig, type ChatConfig } from '../../src/config/runtimeConfig';
import type { Stream } from '../../src/features/catalog/stream';
import {
  CHAT_FEED_NOT_FOUND,
  CONNECTED_BY_CONTENT,
  COULD_NOT_REACH,
  LOCAL_HTTP_UNSUPPORTED,
  MIXED_CONTENT,
  NO_SEGMENT,
  NOT_A_SWARM_GATEWAY,
  SKIPPED,
} from '../../src/features/gateway/checkSentences';
import { onlyGateway } from '../../src/features/gateway/gatewayProbe';
import { CHECKS, type CheckResult, testProvider } from '../../src/features/gateway/providerTest';
import { makeFeedIdentifier } from '../../src/shared/feedFollow';
import { encodeLadderMarker, ladderMarkerIdentifier, markerPeriodAt } from '../../src/shared/ladderMarker';
import { loadUrl } from '../../src/swarm/client';
import { createSwarmClient } from '../../src/swarm/createSwarmClient';
import {
  faultyFetch,
  RECORDED_GATEWAY,
  recordedCatalog,
  recordedFetch,
  recordedStream,
} from '../helpers/recordedBeeGateway';
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
  readonly localNetworkRequests?: boolean;
  readonly now?: () => number;
  /** Whether the gateway is the viewer's own node rather than one the deployment offers. Own by default. */
  readonly isOwnNode?: boolean;
}

async function run({
  fetcher,
  chat = RECORDED_CHAT,
  knownStreams = [],
  catalog = recordedCatalog(),
  address = RECORDED_GATEWAY,
  pageProtocol = 'http:',
  localNetworkRequests = false,
  now,
  isOwnNode = true,
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
    localNetworkRequests,
    now,
    isOwnNode,
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
      fetcher: gateway((url) => (url.includes(CATALOG_HEAD) ? new Response('', { status: 404 }) : undefined)),
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

  it('names the browsers that can reach a plain http node on the local network, in one that cannot', async () => {
    const asked: string[] = [];
    const results = await run({
      fetcher: (async (input: RequestInfo | URL) => {
        asked.push(String(input));
        return new Response('');
      }) as typeof fetch,
      address: 'http://192.168.1.20:1633',
      pageProtocol: 'https:',
      localNetworkRequests: false,
    });

    expect(Object.values(results).map(({ sentence }) => sentence)).toEqual(CHECKS.map(() => LOCAL_HTTP_UNSUPPORTED));
    expect(asked).toEqual([]);
  });
});

/** Answers the URLs `delayOf` names that many milliseconds late, by the test's clock, unless the read is stopped first. */
function slowed(fetcher: typeof fetch, delayOf: (url: string) => number | undefined): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const delayMs = delayOf(String(input));
    if (delayMs === undefined) {
      return fetcher(input, init);
    }
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(fetcher(input, init)), delayMs);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
  }) as typeof fetch;
}

/** The Test on a clock the test moves, so a read of seconds takes none. */
async function runOnTestClock(args: Run): Promise<Record<string, CheckResult>> {
  vi.useFakeTimers();
  const pending = run(args);
  await vi.advanceTimersByTimeAsync(60_000);
  return pending;
}

const CATALOG_HEAD = `/feeds/${recordedCatalog().owner}/${Topic.fromString(recordedCatalog().topic).toHex()}`;
const CHAT_HEAD = '/feeds/c1ba847e';

describe('the window the Test gives each read', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for each read as long as the viewer waits for it, so a 6 s stream list and an 11 s chat head pass', async () => {
    const results = await runOnTestClock({
      fetcher: slowed(gateway(), (url) =>
        url.includes(CATALOG_HEAD) ? 6_000 : url.includes(CHAT_HEAD) ? 11_000 : undefined,
      ),
    });

    expect(results['stream-list']).toEqual({
      check: 'stream-list',
      outcome: 'passed',
      sentence: 'The stream list loaded: 1 stream, entry 0.',
    });
    expect(results.chat.outcome).toBe('passed');
  });

  it('fails a read that has not answered once the 10 s the viewer would wait are up', async () => {
    const results = await runOnTestClock({
      fetcher: gateway((url) => (url.includes(CATALOG_HEAD) ? 'hang' : undefined)),
      knownStreams: recordedStreams(),
    });

    expect(results['stream-list']).toEqual({
      check: 'stream-list',
      outcome: 'failed',
      sentence:
        'The gateway did not answer in 10 s. It may be busy or still starting. Test again in a minute, or pick another gateway.',
    });
  });

  it("asks the viewer's own node for its health for 5 s, as the picker does", async () => {
    const results = await runOnTestClock({ fetcher: gateway((url) => (url === HEALTH ? 'hang' : undefined)) });

    expect(results.connection).toEqual({
      check: 'connection',
      outcome: 'failed',
      sentence:
        'The gateway did not answer in 5 s. It may be busy or still starting. Test again in a minute, or pick another gateway.',
    });
  });
});

const STREAM_HEAD = `/feeds/${recordedStream().owner}/${Topic.fromString(recordedStream().topic).toHex()}`;

/**
 * A gateway the deployment offers, as the event gateway behaves: it serves stream paths only, so `/health` and the
 * chat's paths are refused with no CORS header, which a browser reports as no answer, and a head lookup on a long
 * feed takes 6 s.
 */
function eventGateway(
  asked: string[] = [],
  override: (url: string) => Answer | undefined = () => undefined,
): typeof fetch {
  const refused = (url: string) => url === HEALTH || url.includes(CHAT_HEAD) || url.includes('/chunks/');
  return slowed(
    gateway((url) => {
      asked.push(url);
      return refused(url) ? 'refuse' : override(url);
    }),
    (url) => (url.includes(CATALOG_HEAD) || url.includes(STREAM_HEAD) ? 6_000 : undefined),
  );
}

describe("the control panel's Test, on a gateway the deployment offers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the connection by the content it served, and never asks for its health', async () => {
    const asked: string[] = [];
    const results = await runOnTestClock({ fetcher: eventGateway(asked), isOwnNode: false });

    expect(results.connection).toEqual({ check: 'connection', outcome: 'passed', sentence: CONNECTED_BY_CONTENT });
    expect(results['stream-list'].outcome).toBe('passed');
    expect(asked).not.toContain(HEALTH);
  });

  it("does not test the chat, which reads from the event's chat address rather than from this gateway", async () => {
    const asked: string[] = [];
    const results = await runOnTestClock({ fetcher: eventGateway(asked), isOwnNode: false });

    expect(results.chat).toEqual({ check: 'chat', outcome: 'skipped', sentence: SKIPPED.chatElsewhere });
    expect(SKIPPED.chatElsewhere).toBe(
      "Not tested: the chat reads from the event's chat address, whichever gateway is in use, so only your own node is checked for it.",
    );
    expect(asked.filter((url) => url.includes(CHAT_HEAD) || url.includes('/chunks/'))).toEqual([]);
  });

  it('still says a site with no chat has none', async () => {
    const results = await run({ fetcher: gateway(), chat: null, isOwnNode: false });

    expect(results.chat).toEqual({ check: 'chat', outcome: 'skipped', sentence: SKIPPED.noChat });
  });

  it('reads a recording as the player opens it, by its feed head, and waits the 6 s that head takes', async () => {
    const { owner, topic } = recordedStream();
    const firstEntry = `${RECORDED_GATEWAY}/soc/${owner}/${makeFeedIdentifier(Topic.fromString(topic), FeedIndex.fromBigInt(0n)).toString()}`;
    const asked: string[] = [];
    const results = await runOnTestClock({
      fetcher: eventGateway(asked, (url) => (url === firstEntry ? new Response('', { status: 404 }) : undefined)),
      isOwnNode: false,
    });

    expect(results.player).toEqual({
      check: 'player',
      outcome: 'passed',
      sentence: `The video loaded: a playlist of ${RECORDED_TITLE} and one segment.`,
    });
    expect(asked.filter((url) => url.includes(STREAM_HEAD))).toHaveLength(1);
  });

  it('says it could not be reached when no read got an answer', async () => {
    const results = await run({ fetcher: faultyFetch(), knownStreams: recordedStreams(), isOwnNode: false });

    expect(results.connection).toEqual({ check: 'connection', outcome: 'failed', sentence: COULD_NOT_REACH });
  });

  it('says it did not answer in time when its reads ran out of time', async () => {
    const results = await runOnTestClock({
      fetcher: gateway(() => 'hang'),
      knownStreams: recordedStreams(),
      isOwnNode: false,
    });

    expect(results.connection).toEqual({
      check: 'connection',
      outcome: 'failed',
      sentence:
        'The gateway did not answer in 10 s. It may be busy or still starting. Test again in a minute, or pick another gateway.',
    });
  });

  it('says an address that answers with a web page is not a Swarm gateway', async () => {
    const page = () => new Response('<!doctype html><title>Some site</title>', { status: 200 });
    const results = await run({ fetcher: gateway(page), knownStreams: recordedStreams(), isOwnNode: false });

    expect(results.connection).toEqual({ check: 'connection', outcome: 'failed', sentence: NOT_A_SWARM_GATEWAY });
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

  it('follows a master playlist that names another master at most three levels deep', async () => {
    const LOOP = 'test-loop-master';
    const entryOfLoop = `${GW}/soc/${OWNER}/${makeFeedIdentifier(Topic.fromString(LOOP), FeedIndex.fromBigInt(0n)).toString()}`;
    const master = ['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=400000', `swarm://${OWNER}/${LOOP}`].join('\n');
    // The player opens a stream with no renditions in the list by its feed head, and follows a master's variants.
    const headOfLoop = `${GW}/feeds/${OWNER}/${Topic.fromString(LOOP).toHex()}`;
    let masterReads = 0;
    const loops = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${GW}/health`) {
        return Response.json({ status: 'ok' });
      }
      // Answers a few dozen times only, so a reader with no limit ends rather than running forever.
      if ((url === entryOfLoop || url === headOfLoop) && masterReads < 30) {
        masterReads += 1;
        return new Response(master);
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;
    const stream: Stream = {
      owner: OWNER,
      topic: LOOP,
      title: 'Loop',
      timestamp: NOW,
      mediatype: 'video',
      state: 'vod',
    };

    const results = await run({ fetcher: loops, address: GW, knownStreams: [stream], chat: null, now: () => NOW });

    // Four by the video check, the head and three masters it follows, and two by the previews check, which follows one.
    expect(masterReads).toBe(6);
    expect(results.player).toEqual({ check: 'player', outcome: 'failed', sentence: NO_SEGMENT('Loop') });
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
