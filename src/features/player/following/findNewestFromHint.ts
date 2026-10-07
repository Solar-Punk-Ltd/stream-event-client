import { FeedReader, FollowClock, SEGMENT_MS } from './feedReader';
import { findNewestFromScratch } from './findNewestFromScratch';
import {
  emptyBracket,
  finished,
  isPinned,
  narrowToNewest,
  NewestFound,
  readRound,
  roundAround,
  SearchTally,
} from './searchRounds';

/** What the quality already playing says about where the one being switched to is. */
export interface SwitchHint {
  /** The playing quality's newest index. */
  readonly index: number;
  /** Its newest segment end, on the publisher's clock. */
  readonly newestSegmentEndMs: number;
  /** When the viewer read it, on the viewer's clock. */
  readonly seenAtMs: number;
}

export interface NewestFoundFromHint extends NewestFound {
  readonly usedFallback: boolean;
}

/**
 * Find the newest slot of the quality being switched to, starting from the playing quality's head.
 *
 * The qualities drift apart, so the hint is a place to look rather than an answer. One round of eight
 * around it, moved on by however many segments have passed since it was read, pins the head whenever
 * the two are within a few slots. When the round finds slots but not the head, the highest one's
 * segment end, compared with the hint's on the same publisher clock, says how far ahead the head is,
 * and a round there usually pins it. Nothing here reads the viewer's clock against the publisher's,
 * so a viewer whose clock is wrong pays nothing. When every read around the hint misses, this quality
 * is behind by more than the round can see, and the search from nothing takes over.
 */
export async function findNewestFromHint(
  reader: FeedReader,
  clock: FollowClock,
  hint: SwitchHint,
): Promise<NewestFoundFromHint> {
  const tally: SearchTally = { rounds: 0, reads: 0 };
  const bracket = emptyBracket();
  const elapsedMs = Math.max(0, clock.now() - hint.seenAtMs);
  const centre = hint.index + Math.floor(elapsedMs / SEGMENT_MS);

  await readRound(reader, roundAround(centre, bracket, 3), bracket, tally);
  if (bracket.newest === null) {
    const fallback = await findNewestFromScratch(reader, clock, tally);
    return { ...fallback, usedFallback: true };
  }
  if (isPinned(bracket)) {
    return { ...finished(bracket, tally), usedFallback: false };
  }

  const newest = bracket.newest;
  const aheadMs = hint.newestSegmentEndMs + elapsedMs - newest.newestSegmentEndMs;
  const guess = newest.index + Math.max(1, Math.round(aheadMs / SEGMENT_MS));
  await readRound(reader, roundAround(guess, bracket, 3), bracket, tally);
  return { ...(await narrowToNewest(reader, bracket, tally)), usedFallback: false };
}
