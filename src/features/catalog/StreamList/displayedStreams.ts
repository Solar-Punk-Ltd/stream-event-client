import { scheduledStartMs } from '@/features/catalog/scheduledStart';
import { Stream, STREAM_STATUS_LIVE, STREAM_STATUS_SCHEDULED } from '@/features/catalog/stream';

/** The three groups the browse page shows, each already in the order it is shown in. */
export interface StreamGroups {
  live: Stream[];
  upcoming: Stream[];
  finished: Stream[];
}

type Ordered = Pick<Stream, 'timestamp' | 'index' | 'scheduledStartTime'>;

function newestFirst(a: Ordered, b: Ordered): number {
  const aHasTs = typeof a.timestamp === 'number';
  const bHasTs = typeof b.timestamp === 'number';
  if (aHasTs && bHasTs && a.timestamp !== b.timestamp) {
    return b.timestamp - a.timestamp;
  }
  if (aHasTs !== bHasTs) {
    return aHasTs ? -1 : 1;
  }
  return (b.index ?? 0) - (a.index ?? 0);
}

/** Where an upcoming stream sorts: its start still ahead, its start passed, or no usable start. */
const enum StartPlace {
  Ahead,
  Passed,
  Unknown,
}

function startPlace(startMs: number | null, now: number): StartPlace {
  if (startMs === null) {
    return StartPlace.Unknown;
  }
  return startMs >= now ? StartPlace.Ahead : StartPlace.Passed;
}

/**
 * The streams still ahead first, soonest first, then the ones whose start has passed and that the
 * publisher has not started, the most recently passed first, then the ones with no usable start.
 */
function upcomingOrder(now: number): (a: Ordered, b: Ordered) => number {
  return (a, b) => {
    const aStart = scheduledStartMs(a.scheduledStartTime);
    const bStart = scheduledStartMs(b.scheduledStartTime);
    const aPlace = startPlace(aStart, now);
    const bPlace = startPlace(bStart, now);
    if (aPlace !== bPlace) {
      return aPlace - bPlace;
    }
    if (aStart !== null && bStart !== null && aStart !== bStart) {
      return aPlace === StartPlace.Ahead ? aStart - bStart : bStart - aStart;
    }
    return newestFirst(a, b);
  };
}

/**
 * Every stream on the catalog, split into live, upcoming and finished.
 *
 * A state this has never heard of is filed as finished, so a status a publisher adds later lands
 * among the recordings rather than above a broadcast that is actually running.
 */
export function streamGroups(streamList: readonly Stream[], now: number): StreamGroups {
  const groups: StreamGroups = { live: [], upcoming: [], finished: [] };
  for (const stream of streamList) {
    if (stream.state === STREAM_STATUS_LIVE) {
      groups.live.push(stream);
    } else if (stream.state === STREAM_STATUS_SCHEDULED) {
      groups.upcoming.push(stream);
    } else {
      groups.finished.push(stream);
    }
  }
  groups.live.sort(newestFirst);
  groups.upcoming.sort(upcomingOrder(now));
  groups.finished.sort(newestFirst);
  return groups;
}

/** Every stream on the catalog, in the order the browse page shows them. */
export function displayedStreams(streamList: readonly Stream[], now: number): Stream[] {
  const { live, upcoming, finished } = streamGroups(streamList, now);
  return [...live, ...upcoming, ...finished];
}

/**
 * The sections of the browse page. Every live stream is featured on its own, then the next upcoming
 * stream, then the other upcoming ones and the past ones as cards.
 */
export interface BrowseSections {
  live: Stream[];
  /** The upcoming stream featured above the cards, taken out of `upcoming`. */
  next: Stream | null;
  upcoming: Stream[];
  past: Stream[];
}

/**
 * Features the soonest upcoming stream whose start is still ahead of `now`, as msrs-client does, so a
 * page left open moves the feature on once a start time passes. When no start is ahead, the one whose
 * start passed most recently is featured, because an announcement that is late to go live is still the
 * next thing to watch. Both are simply the first in the upcoming order.
 */
export function browseSections(streamList: readonly Stream[], now: number): BrowseSections {
  const { live, upcoming, finished } = streamGroups(streamList, now);
  const next = upcoming[0] ?? null;
  return { live, next, upcoming: upcoming.slice(1), past: finished };
}
