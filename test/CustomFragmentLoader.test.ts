import { Topic } from '@ethersphere/bee-js';
import type { FragmentLoaderContext, HlsConfig, LoaderCallbacks, LoaderConfiguration, LoaderContext } from 'hls.js';
import { FetchLoader } from 'hls.js';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import { CustomFragmentLoader, manifestFetcher, requestJitter } from '../src/features/player/CustomManifestLoader';
import { FEED_STATE_LIVE, FEED_STATE_RECONNECTING } from '../src/features/player/feedState';
import { ManifestStateManager } from '../src/features/player/ManifestManagement';
import { buildSwarmUri } from '../src/features/player/playlist';
import type { SwarmAnswer } from '../src/swarm/answers';
import type { SwarmReader } from '../src/swarm/client';

const TOPIC = 'a-topic-being-watched';
const FRAGMENT_URL = 'http://127.0.0.1:1633/bytes/0123456789abcdef';

/** hls.js's own loader, which `CustomFragmentLoader` extends and hands the transfer down to. */
const transport = Object.getPrototypeOf(CustomFragmentLoader.prototype) as {
  load: (context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>) => void;
  abort: () => void;
  destroy: () => void;
};

/**
 * Drive a fragment through the loader and hand back the callbacks it gave the transport, so a test
 * can answer as the network would. The transport itself is stubbed out: what is under test is the
 * wiring between a fragment arriving and the feed's health, not hls.js's XHR handling.
 */
function loadFragment(url = FRAGMENT_URL) {
  let handed: LoaderCallbacks<LoaderContext> | null = null;
  vi.spyOn(transport, 'load').mockImplementation((_context, _config, callbacks) => {
    handed = callbacks;
  });

  const loader = new CustomFragmentLoader({} as HlsConfig);
  const fromHls = {
    onSuccess: vi.fn(),
    onError: vi.fn(),
    onTimeout: vi.fn(),
  } as unknown as LoaderCallbacks<LoaderContext>;

  loader.load({ url } as FragmentLoaderContext, {} as LoaderConfiguration, fromHls);

  assert.ok(handed, 'the loader never reached the transport');
  return { fromHls, transport: handed as LoaderCallbacks<LoaderContext> };
}

/**
 * Take the stagger out of the way for the blocks that are about what the loader hands the transport
 * rather than about when it hands it over. Every one of them reads synchronously, and a real stagger
 * would make them all sleep. The stagger has its own block, which does not call this.
 */
function runStaggerInline(): void {
  vi.spyOn(requestJitter, 'stagger').mockImplementation((task) => {
    task();
    return { cancel: () => {} };
  });
}

const arrived = () => ({ url: FRAGMENT_URL, data: new ArrayBuffer(8), code: 200 });

describe('CustomFragmentLoader reporting the gateway it just reached', () => {
  beforeEach(() => {
    manifestFetcher.feedHealth.clear();
    runStaggerInline();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    manifestFetcher.feedHealth.clear();
  });

  /**
   * A viewer's gateway was stopped for 20.5 seconds and the feed was not asked for again until 30,
   * because the manifest backoff doubles from the failure
   * that set it. Segments travel through the same gateway on hls.js's own retry cadence and started
   * arriving the moment it returned, so the client already knew and had nowhere to put it. Wiring
   * this costs no extra request: it reports something the player was fetching anyway.
   */
  it('ends a feed backoff when a segment arrives, without asking for anything extra', () => {
    manifestFetcher.feedHealth.recordGatewayFailure(TOPIC);
    assert.equal(manifestFetcher.feedHealth.state(TOPIC), FEED_STATE_RECONNECTING);

    const { transport: toTransport } = loadFragment();
    toTransport.onSuccess(arrived(), {} as never, {} as LoaderContext, undefined);

    assert.equal(manifestFetcher.feedHealth.backoffRemainingMs(TOPIC), 0);
    assert.equal(manifestFetcher.feedHealth.state(TOPIC), FEED_STATE_LIVE);
  });

  it('passes the segment on to hls.js untouched', () => {
    const { fromHls, transport: toTransport } = loadFragment();
    const response = arrived();
    const stats = { loaded: 8 } as never;
    const context = { url: FRAGMENT_URL } as LoaderContext;

    toTransport.onSuccess(response, stats, context, undefined);

    assert.deepEqual((fromHls.onSuccess as unknown as { mock: { calls: unknown[][] } }).mock.calls, [
      [response, stats, context, undefined],
    ]);
  });

  // A segment that failed is the outage still being on, and it must not shorten the wait.
  it('leaves the backoff alone when the segment does not arrive', () => {
    manifestFetcher.feedHealth.recordGatewayFailure(TOPIC);

    const { fromHls, transport: toTransport } = loadFragment();
    toTransport.onError?.({ code: 0, text: 'gateway unreachable' }, {} as LoaderContext, undefined, {} as never);

    assert.ok(
      manifestFetcher.feedHealth.backoffRemainingMs(TOPIC) > 0,
      'a segment that never arrived released the feed anyway',
    );
    assert.equal(manifestFetcher.feedHealth.state(TOPIC), FEED_STATE_RECONNECTING);
    assert.equal((fromHls.onError as unknown as { mock: { calls: unknown[][] } }).mock.calls.length, 1);
  });
});

/**
 * The other branch through `load`, for a url hls.js could not resolve to a gateway.
 *
 * `blob:http:/bytes/abc123` is not a hand-written example. It is what hls.js 1.6.15's own resolver
 * returns for the media line `/bytes/abc123` against the blob base a preview playlist is served
 * from, measured on 2026-08-07: the page origin and the blob id are both consumed, leaving a url
 * that names no host at all.
 *
 * Rebuilding it against `window.location.origin` and handing it to the transport would name the
 * client, whose host proxies `/bee/` and not `/bytes/`, so the fragment would 404 at a host that never
 * held it and no message would connect the failure to the fallback.
 */
describe('CustomFragmentLoader meeting a url that names no gateway', () => {
  const UNRESOLVABLE = 'blob:http:/bytes/abc123';

  /** Drive one url through the loader, and report both what the transport saw and what hls.js was told. */
  function offer(url: string) {
    const reachedTransport = vi.spyOn(transport, 'load').mockImplementation(() => {});
    const loader = new CustomFragmentLoader({} as HlsConfig);
    const fromHls = {
      onSuccess: vi.fn(),
      onError: vi.fn(),
      onTimeout: vi.fn(),
    } as unknown as LoaderCallbacks<LoaderContext>;

    loader.load({ url } as FragmentLoaderContext, {} as LoaderConfiguration, fromHls);

    const errors = (fromHls.onError as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    return {
      transportCalls: reachedTransport.mock.calls.length,
      errors: errors.map((call) => call[0] as { code: number; text: string }),
    };
  }

  beforeEach(() => {
    manifestFetcher.feedHealth.clear();
    runStaggerInline();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    manifestFetcher.feedHealth.clear();
  });

  it('refuses it instead of fetching an origin that never held the segment', () => {
    const { transportCalls, errors } = offer(UNRESOLVABLE);

    assert.equal(transportCalls, 0, 'an unresolvable url was still sent to the network');
    assert.equal(errors.length, 1);
    assert.match(errors[0].text, /not absolute/);
  });

  // The url is the whole of what a reader has to go on, so it has to survive into the message.
  it('names the url it refused', () => {
    assert.match(offer(UNRESOLVABLE).errors[0].text, /blob:http:\/bytes\/abc123/);
  });

  // A refusal must not read as the gateway answering, which is the one thing this loader reports.
  it('leaves the feed backoff alone, since nothing was fetched from anywhere', () => {
    manifestFetcher.feedHealth.recordGatewayFailure(TOPIC);

    offer(UNRESOLVABLE);

    assert.ok(manifestFetcher.feedHealth.backoffRemainingMs(TOPIC) > 0);
    assert.equal(manifestFetcher.feedHealth.state(TOPIC), FEED_STATE_RECONNECTING);
  });

  // The control. Without it the block above passes on a loader that refuses everything.
  it('lets an absolute gateway url through to the transport', () => {
    const { transport: toTransport } = loadFragment();
    toTransport.onSuccess(arrived(), {} as never, {} as LoaderContext, undefined);

    assert.equal(manifestFetcher.feedHealth.state(TOPIC), FEED_STATE_LIVE);
  });
});

/**
 * The block that does NOT call {@link runStaggerInline}, because the stagger is what it is about.
 *
 * hls.js abandons fragments as a matter of course: on a level switch, on a seek, and on every
 * teardown. Before the stagger existed the transport had already been handed the fragment by the
 * time any of that happened, and hls.js's own loader owned the cancellation. Holding the request
 * back opens a window where it has not, and a stagger that fired anyway would start a transfer for a
 * fragment nobody is waiting for, on a loader hls.js has finished with. The gateway pays for that
 * request and nothing consumes it, which is the shape of every leak this project has found.
 */
describe('CustomFragmentLoader holding a fragment back', () => {
  let staggered: (() => void)[] = [];
  let cancelled = 0;

  beforeEach(() => {
    manifestFetcher.feedHealth.clear();
    staggered = [];
    cancelled = 0;
    vi.spyOn(requestJitter, 'stagger').mockImplementation((task) => {
      staggered.push(task);
      return {
        cancel: () => {
          cancelled++;
        },
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    manifestFetcher.feedHealth.clear();
  });

  /** Stubs the transport and the two teardown paths, none of which survive outside a browser. */
  function stubbedLoader() {
    const reachedTransport = vi.spyOn(transport, 'load').mockImplementation(() => {});
    vi.spyOn(transport, 'abort').mockImplementation(() => {});
    vi.spyOn(transport, 'destroy').mockImplementation(() => {});

    const loader = new CustomFragmentLoader({} as HlsConfig);
    loader.load(
      { url: FRAGMENT_URL } as FragmentLoaderContext,
      {} as LoaderConfiguration,
      {
        onSuccess: vi.fn(),
        onError: vi.fn(),
        onTimeout: vi.fn(),
      } as unknown as LoaderCallbacks<LoaderContext>,
    );

    return { loader, reachedTransport };
  }

  it('does not reach the transport until the stagger is up', () => {
    const { reachedTransport } = stubbedLoader();

    assert.equal(reachedTransport.mock.calls.length, 0, 'the fragment went straight out, unstaggered');
    assert.equal(staggered.length, 1, 'the fragment was never staggered');

    staggered[0]();
    assert.equal(reachedTransport.mock.calls.length, 1);
  });

  it('cancels a fragment that hls.js aborted before the stagger was up', () => {
    const { loader, reachedTransport } = stubbedLoader();

    loader.abort();

    assert.equal(cancelled, 1, 'aborting left the stagger armed');
    assert.equal(reachedTransport.mock.calls.length, 0, 'an aborted fragment still reached the network');
  });

  it('cancels a fragment that hls.js destroyed before the stagger was up', () => {
    const { loader, reachedTransport } = stubbedLoader();

    loader.destroy();

    assert.equal(cancelled, 1, 'destroying left the stagger armed');
    assert.equal(reachedTransport.mock.calls.length, 0, 'a destroyed fragment still reached the network');
  });

  /**
   * The counterpart, and the reason cancelling is not just "always cancel". A loader that cancelled a
   * stagger it no longer owned would be reaching for a timer some later fragment had armed.
   */
  it('has nothing left to cancel once the fragment is away', () => {
    const { loader } = stubbedLoader();
    staggered[0]();

    loader.abort();

    assert.equal(cancelled, 0, 'a fragment already handed over was cancelled anyway');
  });

  // Without this the block above passes on a loader that refuses every url before staggering at all.
  it('never staggers a url it is going to refuse, since nothing would be fetched', () => {
    vi.spyOn(transport, 'load').mockImplementation(() => {});

    const loader = new CustomFragmentLoader({} as HlsConfig);
    loader.load(
      { url: '/bytes/0123456789abcdef' } as FragmentLoaderContext,
      {} as LoaderConfiguration,
      {
        onSuccess: vi.fn(),
        onError: vi.fn(),
        onTimeout: vi.fn(),
      } as unknown as LoaderCallbacks<LoaderContext>,
    );

    assert.equal(staggered.length, 0, 'a url that names no gateway was queued for a stagger anyway');
  });
});

/**
 * A viewer switched the video from the event gateway to another one while watching a recording, on
 * 2026-10-17, and every segment kept loading from the old gateway for at least a minute. A recording's
 * playlist is read once, so hls.js keeps the URLs it was first given. The loader is the one place every
 * segment passes through after that, so it is where a switch has to reach them.
 */
describe('CustomFragmentLoader following the source the player reads from now', () => {
  const OWNER = '4'.repeat(40);
  const SEGMENT_TOPIC = 'a-recording-watched-across-a-switch';
  const hexTopic = Topic.fromString(SEGMENT_TOPIC).toString();
  const SEGMENT_REF = 'cd'.repeat(32);
  const RECORDING = [
    '#EXTM3U',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-TARGETDURATION:2',
    '#EXTINF:2.0,',
    SEGMENT_REF,
    '#EXT-X-ENDLIST',
  ].join('\n');

  /** A reader that names segments the way a Bee node's HTTP API does. */
  function gatewayReader(base: string): SwarmReader {
    const recording: SwarmAnswer = {
      kind: 'content',
      bytes: new TextEncoder().encode(RECORDING),
      feedIndex: 0,
      serverTimeMs: null,
    };
    return {
      readFeedHead: async () => recording,
      readFeedEntry: async () => recording,
      readSoc: async () => ({ kind: 'not-found', serverTimeMs: null }),
      readChunk: async () => ({ kind: 'not-found', serverTimeMs: null }),
      readBytes: async () => ({ kind: 'not-found', serverTimeMs: null }),
      urlFor: (reference) => `${base}/bytes/${reference}`,
      reportUrlLoad: () => {},
    };
  }

  const OLD = gatewayReader('https://old-gateway.example.com');
  const NEW = gatewayReader('https://new-gateway.example.com');

  /** The segment URL the recording's playlist handed hls.js while the player read from `reader`. */
  async function segmentNamedUnder(reader: SwarmReader): Promise<string> {
    manifestFetcher.useSwarm(reader);
    const playlist = await manifestFetcher.fetchSource(buildSwarmUri(OWNER, SEGMENT_TOPIC));
    const line = playlist.split('\n').find((entry) => entry.endsWith(SEGMENT_REF));
    assert.ok(line, 'the recording named no segment');
    return line;
  }

  /** The URL the transport was asked for when hls.js loaded `url`. */
  function transportedUrl(url: string): string {
    const reachedTransport = vi.spyOn(transport, 'load').mockImplementation(() => {});
    new CustomFragmentLoader({} as HlsConfig).load(
      { url } as FragmentLoaderContext,
      {} as LoaderConfiguration,
      { onSuccess: vi.fn(), onError: vi.fn(), onTimeout: vi.fn() } as unknown as LoaderCallbacks<LoaderContext>,
    );
    assert.equal(reachedTransport.mock.calls.length, 1, 'the fragment never reached the transport');
    return reachedTransport.mock.calls[0][0].url;
  }

  beforeEach(() => {
    manifestFetcher.feedHealth.clear();
    runStaggerInline();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ManifestStateManager.getInstance().clear(hexTopic);
    manifestFetcher.useSwarm(gatewayReader('https://nowhere.example.com'));
    manifestFetcher.feedHealth.clear();
  });

  it('loads a segment named under the old gateway from the one switched to', async () => {
    const named = await segmentNamedUnder(OLD);
    assert.equal(named, `https://old-gateway.example.com/bytes/${SEGMENT_REF}`);

    manifestFetcher.useSwarm(NEW);

    assert.equal(transportedUrl(named), `https://new-gateway.example.com/bytes/${SEGMENT_REF}`);
  });

  // The control. Without it the test above passes on a loader that renames before any switch.
  it('loads it from the gateway that named it while nothing was switched', async () => {
    const named = await segmentNamedUnder(OLD);

    assert.equal(transportedUrl(named), named);
  });

  // hls.js asks again with the fragment's own URL, which is still the one the old gateway named.
  it('sends a retry of that segment to the gateway switched to as well', async () => {
    const named = await segmentNamedUnder(OLD);
    manifestFetcher.useSwarm(NEW);
    const reachedTransport = vi.spyOn(transport, 'load').mockImplementation(() => {});
    const loader = new CustomFragmentLoader({} as HlsConfig);
    const fromHls = { onSuccess: vi.fn(), onError: vi.fn(), onTimeout: vi.fn() };

    loader.load({ url: named } as FragmentLoaderContext, {} as LoaderConfiguration, fromHls as never);
    loader.load({ url: named } as FragmentLoaderContext, {} as LoaderConfiguration, fromHls as never);

    assert.deepEqual(
      reachedTransport.mock.calls.map((call) => call[0].url),
      [`https://new-gateway.example.com/bytes/${SEGMENT_REF}`, `https://new-gateway.example.com/bytes/${SEGMENT_REF}`],
    );
  });

  /**
   * A recording published before 2026-08-13 names its segments by the publisher's gateway, and a stream
   * card's preview names its own through the previews' source. Neither is the player's to rename.
   */
  it('passes a segment URL the player did not name through unchanged', async () => {
    await segmentNamedUnder(OLD);
    manifestFetcher.useSwarm(NEW);
    const notNamedHere = `https://publisher-gateway.example.com/bytes/${SEGMENT_REF}`;

    assert.equal(transportedUrl(notNamedHere), notNamedHere);
  });
});

/**
 * A segment from the Freedom browser's own node, at a `bzz://` URL. Freedom registers that scheme for `fetch` and
 * promises nothing for XHR, hls.js's default, so the loader hands it to hls.js's fetch loader. It reports nothing to
 * the feeds' health: the playlists are read through Freedom's `window.swarm` under a budget a segment does not touch,
 * so a segment arriving says nothing about whether they can be read.
 */
describe('CustomFragmentLoader loading a segment from the Freedom browser over bzz://', () => {
  const BZZ_SEGMENT = `bzz://${'cd'.repeat(32)}/`;

  /** hls.js's fetch loader as it is driven, with the callbacks and the URL it was handed. */
  function loadOverBzz(url = BZZ_SEGMENT) {
    let handed: { url: string; callbacks: LoaderCallbacks<LoaderContext>; stats: unknown } | null = null;
    const xhr = vi.spyOn(transport, 'load').mockImplementation(() => {});
    vi.spyOn(FetchLoader.prototype, 'load').mockImplementation(function (
      this: { stats: unknown },
      context,
      _config,
      callbacks,
    ) {
      handed = { url: context.url, callbacks, stats: this.stats };
    });
    const loader = new CustomFragmentLoader({} as HlsConfig);
    const fromHls = {
      onSuccess: vi.fn(),
      onError: vi.fn(),
      onTimeout: vi.fn(),
    } as unknown as LoaderCallbacks<LoaderContext>;

    loader.load({ url } as FragmentLoaderContext, {} as LoaderConfiguration, fromHls);

    return { loader, fromHls, xhr, handed: handed as unknown as NonNullable<typeof handed> };
  }

  beforeEach(() => {
    manifestFetcher.feedHealth.clear();
    runStaggerInline();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    manifestFetcher.feedHealth.clear();
  });

  it("hands it to hls.js's fetch loader, not to its XHR loader, with the stats hls.js reads off this loader", () => {
    const { loader, xhr, handed } = loadOverBzz();

    assert.ok(handed, 'the bzz:// segment never reached the fetch loader');
    assert.equal(handed.url, BZZ_SEGMENT);
    assert.equal(handed.stats, loader.stats);
    assert.equal(xhr.mock.calls.length, 0);
  });

  it('passes the segment on to hls.js, and ends no feed backoff', () => {
    manifestFetcher.feedHealth.recordGatewayFailure(TOPIC);
    const { fromHls, handed } = loadOverBzz();

    handed.callbacks.onSuccess(arrived(), {} as never, {} as LoaderContext, undefined);

    assert.equal((fromHls.onSuccess as unknown as { mock: { calls: unknown[][] } }).mock.calls.length, 1);
    assert.equal(manifestFetcher.feedHealth.state(TOPIC), FEED_STATE_RECONNECTING);
  });

  it('stops the fetch loader when hls.js abandons the segment', () => {
    const aborted = vi.spyOn(FetchLoader.prototype, 'abort').mockImplementation(() => {});
    vi.spyOn(transport, 'abort').mockImplementation(() => {});
    const { loader } = loadOverBzz();

    loader.abort();

    assert.equal(aborted.mock.calls.length, 1);
  });
});
