import { FeedEntry, FeedReader, FollowClock, MAX_PARALLEL_READS, SEGMENT_MS } from './feedReader';
import {
  Bracket,
  emptyBracket,
  finished,
  isPinned,
  narrowToNewest,
  NewestFound,
  newestIndexOf,
  readRound,
  roundAround,
  SearchTally,
} from './searchRounds';

/**
 * The first round: slot 0 and then every power of four less one, up to 16,383. A feed of any length
 * up to that is bracketed within a factor of four, and a longer one gives its 16,383rd entry, whose
 * segment time places the head by the clock.
 */
export const FIRST_ROUND: readonly number[] = Array.from({ length: MAX_PARALLEL_READS }, (_, power) =>
  power === 0 ? 0 : 4 ** power - 1,
);

/** What a slot's lag behind its segment end is taken to be before anything has been measured. */
const ASSUMED_LAG_MS = 1_000;

/**
 * Find a feed's newest slot by reading slots by index, never through Bee's own lookup.
 *
 * One round at powers of four brackets the feed. The highest slot found then says how far the head
 * can be: no more slots than segments have ended since its newest segment, by the viewer's clock.
 * The pace between the two highest slots found refines that into a guess, which allows for playlists
 * that coalesced and for pauses between sessions, and a round of eight reads just below the bound
 * usually lands on the head. A wrong clock or a guess that missed costs a few more rounds of the plain
 * search, never a wrong answer: the search only ends on a slot read and the slot above it read missing.
 */
export async function findNewestFromScratch(
  reader: FeedReader,
  clock: FollowClock,
  tally: SearchTally = { rounds: 0, reads: 0 },
): Promise<NewestFound> {
  const bracket = emptyBracket();
  const hits: FeedEntry[] = [];
  const trackingReader: FeedReader = {
    read: async (index) => {
      const read = await reader.read(index);
      if (read.found) {
        hits.push(read.entry);
      }
      return read;
    },
  };

  await readRound(trackingReader, FIRST_ROUND, bracket, tally);
  if (bracket.newest === null || isPinned(bracket)) {
    if (bracket.newest === null) {
      bracket.firstMissing = 0;
    }
    return finished(bracket, tally);
  }

  await readRound(trackingReader, guessRound(bracket, hits, clock.now()), bracket, tally);
  return narrowToNewest(trackingReader, bracket, tally);
}

function guessRound(bracket: Bracket, hits: readonly FeedEntry[], nowMs: number): number[] {
  const newest = bracket.newest!;
  const sinceNewestMs = nowMs - newest.newestSegmentEndMs;
  const bound = newest.index + Math.max(1, Math.ceil(sinceNewestMs / SEGMENT_MS));

  const older = hits
    .filter((hit) => hit.index < newest.index)
    .reduce<FeedEntry | null>((best, hit) => (best === null || hit.index > best.index ? hit : best), null);
  let slotsPerMs = 1 / SEGMENT_MS;
  if (older !== null && newest.newestSegmentEndMs > older.newestSegmentEndMs) {
    slotsPerMs = Math.min(
      slotsPerMs,
      (newest.index - older.index) / (newest.newestSegmentEndMs - older.newestSegmentEndMs),
    );
  }
  const guess = Math.min(bound, newest.index + Math.round(slotsPerMs * (sinceNewestMs - ASSUMED_LAG_MS)));

  const wanted = roundAround(Math.max(guess, newestIndexOf(bracket) + 1), bracket);
  // The bound itself is read too, in place of the lowest of the eight, so that a guess that fell
  // short still leaves a miss above it to cut down from, rather than a gallop.
  const below = bracket.firstMissing ?? Infinity;
  if (bound < below && bound > Math.max(newest.index, ...wanted)) {
    if (wanted.length < MAX_PARALLEL_READS) {
      wanted.push(bound);
    } else {
      wanted[0] = bound;
    }
  }
  return wanted;
}
