import { Topic } from '@ethersphere/bee-js';
import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';

import {
  CATALOG_POLL_INTERVAL_MS,
  retryCatalogReadAfter,
  watchPageCatalogPollMs,
} from '../src/features/catalog/catalogPoll';
import { catalogUpdater, StreamCatalog, toCatalogRead } from '../src/features/catalog/catalogState';
import { Stream, STREAM_STATUS_LIVE, STREAM_STATUS_SCHEDULED } from '../src/features/catalog/stream';
import { CatalogFeedReader } from '../src/features/catalog/catalogFeed';
import type { PathResponse } from './helpers/playerReader';
import { readerOverPaths } from './helpers/playerReader';
import {
  isWaitingForStart,
  WATCH_VIEW_LOADING,
  WATCH_VIEW_NOT_STARTED,
  WATCH_VIEW_PLAYER,
  WATCH_VIEW_UNAVAILABLE,
  WatchPageView,
  watchPageView,
} from '../src/features/catalog/watchPageView';

describe('when the watch page reads the catalog again', () => {
  it('reads it at the same pace as the browse page while the stream has not started, so a reschedule or a cancellation reaches the page', () => {
    assert.equal(watchPageCatalogPollMs(WATCH_VIEW_NOT_STARTED), CATALOG_POLL_INTERVAL_MS);
  });

  it('keeps reading it while the stream it waited for is missing, so a republish reaches the page', () => {
    assert.equal(watchPageCatalogPollMs(WATCH_VIEW_UNAVAILABLE), CATALOG_POLL_INTERVAL_MS);
  });

  /**
   * The player follows the stream's own feeds from then on, and that includes a deep link to a topic
   * the catalog does not list, so there is nothing for a catalog poll to wait for.
   */
  it('stops once the player is mounted', () => {
    assert.equal(watchPageCatalogPollMs(WATCH_VIEW_PLAYER), null);
  });

  it('adds no read of its own before the first one lands, which the app makes itself', () => {
    assert.equal(watchPageCatalogPollMs(WATCH_VIEW_LOADING), null);
  });
});

/**
 * ⛔ SWR skips its refresh timer while its cache holds an error and leaves the next read to
 * `onErrorRetry`, whose default waits longer after every failure, from 5 to 10 s after one up to
 * minutes after a few in a row. One slow or refused read used to hold an open page that far behind.
 */
describe('after a failed catalog read', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function retryOf(pollMs: number | null, visible = () => true) {
    const revalidate = vi.fn(async () => true);
    const config = { isVisible: visible } as unknown as Parameters<
      NonNullable<ReturnType<typeof retryCatalogReadAfter>>
    >[2];
    const retry = retryCatalogReadAfter(pollMs);
    return {
      revalidate,
      fail: (retryCount: number) => retry?.(new Error('slow'), 'app-state', config, revalidate, { retryCount }),
    };
  }

  it('reads again one poll interval later, however many reads failed before it', () => {
    vi.useFakeTimers();
    const { revalidate, fail } = retryOf(CATALOG_POLL_INTERVAL_MS);

    fail(1);
    vi.advanceTimersByTime(CATALOG_POLL_INTERVAL_MS - 1);
    assert.equal(revalidate.mock.calls.length, 0);
    vi.advanceTimersByTime(1);
    assert.equal(revalidate.mock.calls.length, 1);

    fail(6);
    vi.advanceTimersByTime(CATALOG_POLL_INTERVAL_MS);
    assert.equal(revalidate.mock.calls.length, 2, 'a sixth failure in a row was backed off');
  });

  it('drops the retry when the page is hidden by the time it is due, since SWR reads again when it is shown', () => {
    vi.useFakeTimers();
    const { revalidate, fail } = retryOf(CATALOG_POLL_INTERVAL_MS, () => false);

    fail(1);
    vi.advanceTimersByTime(CATALOG_POLL_INTERVAL_MS);

    assert.equal(revalidate.mock.calls.length, 0);
  });

  it('schedules nothing for a page that does not poll', () => {
    vi.useFakeTimers();
    const { revalidate, fail } = retryOf(null);

    fail(1);
    vi.advanceTimersByTime(60_000);

    assert.equal(revalidate.mock.calls.length, 0);
  });
});

const GATEWAY = 'https://gateway.example';

function catalogSlot(streams: Stream[], headers = new Headers()): PathResponse {
  return { ok: true, status: 200, headers, text: JSON.stringify(streams) };
}

/** The head of the catalog feed, which is the one answer that says which slot it is. */
function catalogHead(slot: number, streams: Stream[]): PathResponse {
  return catalogSlot(streams, new Headers({ 'swarm-feed-index': slot.toString(16).padStart(16, '0') }));
}

const SLOT_NOT_WRITTEN_YET: PathResponse = { ok: false, status: 404, headers: new Headers(), text: '' };

/** A gateway that answers the catalog reader's requests in the order given. */
function gatewayAnswering(answers: PathResponse[]) {
  return async (): Promise<PathResponse> => {
    const answer = answers.shift();
    if (!answer) {
      throw new Error('the reader asked for a slot this feed does not hold');
    }
    return answer;
  };
}

/** A scheduled stream that is not the newest entry, which is the case the last-entry rule missed. */
const announced: Stream = {
  owner: '0xabc',
  topic: 'announced-topic',
  title: 'announced',
  mediatype: 'video',
  timestamp: 100,
  state: STREAM_STATUS_SCHEDULED,
};
const newest: Stream = {
  owner: '0xabc',
  topic: 'newest-topic',
  title: 'newest',
  mediatype: 'video',
  timestamp: 200,
  state: STREAM_STATUS_LIVE,
};

const NOTHING_HELD: StreamCatalog = { streams: [], gateway: null, slot: null };

/**
 * One catalog poll as the app makes it: the reader's answer from a gateway that answers in the order
 * given, applied to the list on screen through the list's own update rule.
 */
function pollerAnswering(answers: PathResponse[]): (held: StreamCatalog) => Promise<StreamCatalog> {
  const selectedGateway = { current: GATEWAY };
  const reader = new CatalogFeedReader(announced.owner, Topic.fromString('catalog-test'));
  const gateway = readerOverPaths(gatewayAnswering(answers));
  return async (held) => catalogUpdater(toCatalogRead(GATEWAY, await reader.read(gateway)), selectedGateway)(held);
}

/** The announced stream's entry in the list, the way the watch page finds it. */
function listedAnnounced(catalog: StreamCatalog): Stream | undefined {
  return catalog.streams.find((entry) => entry.owner === announced.owner && entry.topic === announced.topic);
}

/**
 * ⛔ The watch page's path from a poll to its decision, for a scheduled stream that is not the newest.
 *
 * The web2 admin turns an announced stream live by replacing its entry where it stands, so the last
 * entry of the catalog stays the same. The stream list used to compare only the last entries, so this
 * page started a scheduled stream only when it was the newest in the catalog, and showed "This stream
 * has not started yet" for any other until the viewer reloaded.
 *
 * Driven through the catalog reader and the read it hands the list, rather than through the list's
 * rule alone, so that a slot lost anywhere on the way fails here instead of falling back to the old
 * ordering without a sound.
 */
describe('when a scheduled stream that is not the newest entry goes live in place', () => {
  /** What the watch page shows for the announced stream, from the list it holds. */
  function shownView(catalog: StreamCatalog): WatchPageView {
    const listed = listedAnnounced(catalog);
    return watchPageView(true, listed, isWaitingForStart(true, listed));
  }

  it('stops showing it as not started on the next poll', async () => {
    const poll = pollerAnswering([
      catalogHead(7, [announced, newest]),
      catalogSlot([{ ...announced, state: STREAM_STATUS_LIVE, timestamp: 300 }, newest]),
      SLOT_NOT_WRITTEN_YET,
    ]);

    const opened = await poll(NOTHING_HELD);
    const afterGoLive = await poll(opened);

    assert.equal(shownView(opened), WATCH_VIEW_NOT_STARTED);
    assert.equal(shownView(afterGoLive), WATCH_VIEW_PLAYER, 'the page still shows the stream as not started');
  });
});

/**
 * ⛔ The same path, for a scheduled stream the web2 admin unpublishes, which removes its entry and
 * touches no other. Once the list follows every catalog change, the entry leaves the page's list on the
 * next poll, and the page used to answer that by mounting the player on a feed nobody had written.
 *
 * The page's memory is carried from poll to poll here the way the page carries it, through
 * `isWaitingForStart`, because the list alone cannot tell a stream that was unpublished from one the
 * catalog never had.
 */
describe('when a scheduled stream that is not the newest entry is unpublished', () => {
  it('says it is no longer available, and shows it again when it is republished', async () => {
    const poll = pollerAnswering([
      catalogHead(7, [announced, newest]),
      catalogSlot([newest]),
      SLOT_NOT_WRITTEN_YET,
      catalogSlot([{ ...announced, timestamp: 300 }, newest]),
      SLOT_NOT_WRITTEN_YET,
    ]);

    const opened = await poll(NOTHING_HELD);
    const afterUnpublish = await poll(opened);
    const afterRepublish = await poll(afterUnpublish);

    const waitingWhenOpened = isWaitingForStart(false, listedAnnounced(opened));
    const waitingAfterUnpublish = isWaitingForStart(waitingWhenOpened, listedAnnounced(afterUnpublish));
    const waitingAfterRepublish = isWaitingForStart(waitingAfterUnpublish, listedAnnounced(afterRepublish));
    const viewAfterUnpublish = watchPageView(true, listedAnnounced(afterUnpublish), waitingAfterUnpublish);

    assert.equal(watchPageView(true, listedAnnounced(opened), waitingWhenOpened), WATCH_VIEW_NOT_STARTED);
    assert.equal(viewAfterUnpublish, WATCH_VIEW_UNAVAILABLE, 'the page mounts a player that can never load');
    assert.equal(watchPageCatalogPollMs(viewAfterUnpublish), CATALOG_POLL_INTERVAL_MS);
    assert.equal(
      watchPageView(true, listedAnnounced(afterRepublish), waitingAfterRepublish),
      WATCH_VIEW_NOT_STARTED,
      'a republished stream does not come back to a page that stopped reading the catalog',
    );
  });
});
