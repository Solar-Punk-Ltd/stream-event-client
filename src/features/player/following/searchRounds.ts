import { FeedEntry, FeedReader, MAX_PARALLEL_READS } from './feedReader';

/**
 * What a search knows so far: the newest slot it has read, and the lowest slot above that it read
 * and found missing. The search is over once the two touch.
 */
export interface Bracket {
  newest: FeedEntry | null;
  firstMissing: number | null;
}

export interface SearchTally {
  rounds: number;
  reads: number;
}

/** A finished search. `firstMissing` is always `newest.index + 1`, or 0 for a feed with nothing in it. */
export interface NewestFound {
  readonly newest: FeedEntry | null;
  readonly firstMissing: number;
  readonly rounds: number;
  readonly reads: number;
}

export function emptyBracket(): Bracket {
  return { newest: null, firstMissing: null };
}

export function newestIndexOf(bracket: Bracket): number {
  return bracket.newest?.index ?? -1;
}

export function isPinned(bracket: Bracket): boolean {
  return bracket.firstMissing === newestIndexOf(bracket) + 1;
}

/**
 * Read up to eight slots at once and fold the answers into the bracket.
 *
 * A miss below the newest hit is a hole, not the head, so it never becomes the upper end: a slot the
 * node refuses for a while must not stop the search short of the publisher.
 */
export async function readRound(
  reader: FeedReader,
  wanted: readonly number[],
  bracket: Bracket,
  tally: SearchTally,
): Promise<void> {
  const indexes = [...new Set(wanted.filter((index) => index >= 0))].slice(0, MAX_PARALLEL_READS);
  if (indexes.length === 0) {
    return;
  }
  tally.rounds += 1;
  tally.reads += indexes.length;
  const reads = await Promise.all(indexes.map((index) => reader.read(index)));

  const misses: number[] = bracket.firstMissing === null ? [] : [bracket.firstMissing];
  reads.forEach((read, position) => {
    if (read.found) {
      if (bracket.newest === null || read.entry.index > bracket.newest.index) {
        bracket.newest = read.entry;
      }
    } else {
      misses.push(indexes[position]);
    }
  });
  const above = misses.filter((index) => index > newestIndexOf(bracket));
  bracket.firstMissing = above.length === 0 ? null : Math.min(...above);
}

/**
 * Close the bracket. With no miss known yet the search gallops, eight reads spaced by powers of two
 * and wider each round. With both ends known it cuts the gap into nine and reads the eight cuts,
 * which takes a gap of 60,000 to a single slot in five rounds.
 */
export async function narrowToNewest(reader: FeedReader, bracket: Bracket, tally: SearchTally): Promise<NewestFound> {
  let scale = 1;
  while (!isPinned(bracket)) {
    const low = newestIndexOf(bracket);
    let wanted: number[];
    if (bracket.firstMissing === null) {
      wanted = Array.from({ length: MAX_PARALLEL_READS }, (_, power) => low + scale * 2 ** power);
      scale *= 2 ** MAX_PARALLEL_READS;
    } else {
      const gap = bracket.firstMissing - low - 1;
      wanted =
        gap <= MAX_PARALLEL_READS
          ? Array.from({ length: gap }, (_, offset) => low + 1 + offset)
          : Array.from({ length: MAX_PARALLEL_READS }, (_, cut) =>
              Math.round(low + ((cut + 1) * (gap + 1)) / (MAX_PARALLEL_READS + 1)),
            );
    }
    await readRound(reader, wanted, bracket, tally);
  }
  return finished(bracket, tally);
}

export function finished(bracket: Bracket, tally: SearchTally): NewestFound {
  return {
    newest: bracket.newest,
    firstMissing: newestIndexOf(bracket) + 1,
    rounds: tally.rounds,
    reads: tally.reads,
  };
}

/** Eight consecutive slots ending one past `guess`, kept inside what the bracket still allows. */
export function roundAround(guess: number, bracket: Bracket, before = 5): number[] {
  const low = newestIndexOf(bracket);
  const high = bracket.firstMissing ?? Infinity;
  return Array.from({ length: MAX_PARALLEL_READS }, (_, offset) => guess - before + offset).filter(
    (index) => index > low && index < high,
  );
}
