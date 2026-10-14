import type { SwarmAnswer } from '../../answers';

/** The most entries a search reads at once, as many as Bee's own lookup opens per round. */
const PARALLEL_READS = 8;

/** The first round: entry 0 and every power of four less one, which brackets a feed of up to 16,383 entries. */
const FIRST_ROUND: readonly number[] = Array.from({ length: PARALLEL_READS }, (_, power) =>
  power === 0 ? 0 : 4 ** power - 1,
);

type ReadEntry = (index: number) => Promise<SwarmAnswer>;

type ContentAnswer = Extract<SwarmAnswer, { kind: 'content' }>;

interface Bracket {
  newest: { readonly index: number; readonly answer: ContentAnswer } | null;
  /** The lowest entry above {@link newest} read and found missing. */
  firstMissing: number | null;
}

const newestIndexOf = (bracket: Bracket) => bracket.newest?.index ?? -1;

/** The entries the next round reads: wider each round while no miss is known, then even cuts of the gap. */
function nextRound(bracket: Bracket, gallop: number): number[] {
  const low = newestIndexOf(bracket);
  if (bracket.firstMissing === null) {
    return Array.from({ length: PARALLEL_READS }, (_, power) => low + gallop * 2 ** power);
  }
  const gap = bracket.firstMissing - low - 1;
  if (gap <= PARALLEL_READS) {
    return Array.from({ length: gap }, (_, offset) => low + 1 + offset);
  }
  return Array.from({ length: PARALLEL_READS }, (_, cut) =>
    Math.round(low + ((cut + 1) * (gap + 1)) / (PARALLEL_READS + 1)),
  );
}

/**
 * A feed's newest entry, found by reading entries by index, for a node with no lookup that reports one. Each round
 * reads up to eight entries at once: the first brackets the feed, the next ones gallop past the newest entry found
 * until one misses, and then cut the gap evenly until the newest entry and the missing one above it touch. A miss
 * below the newest entry found is a hole, never the head.
 *
 * Every read answers as it does: the search ends on the first round that met anything but content or not found, and
 * answers that, since a head it could not prove would be a wrong one. The answer found carries its index.
 */
export async function findNewestEntry(read: ReadEntry): Promise<SwarmAnswer> {
  const bracket: Bracket = { newest: null, firstMissing: null };
  let wanted = [...FIRST_ROUND];
  let gallop = 1;
  for (;;) {
    const indexes = [...new Set(wanted)].filter((index) => Number.isSafeInteger(index) && index >= 0);
    const answers = await Promise.all(indexes.map((index) => read(index)));
    const fault = answers.find((answer) => answer.kind !== 'content' && answer.kind !== 'not-found');
    if (fault) {
      return fault;
    }
    const misses: number[] = bracket.firstMissing === null ? [] : [bracket.firstMissing];
    answers.forEach((answer, at) => {
      const index = indexes[at];
      if (answer.kind === 'content') {
        if (index > newestIndexOf(bracket)) {
          bracket.newest = { index, answer };
        }
      } else {
        misses.push(index);
      }
    });
    const above = misses.filter((index) => index > newestIndexOf(bracket));
    bracket.firstMissing = above.length === 0 ? null : Math.min(...above);

    if (bracket.newest === null) {
      return { kind: 'not-found', serverTimeMs: null };
    }
    if (bracket.firstMissing === bracket.newest.index + 1) {
      return { ...bracket.newest.answer, feedIndex: bracket.newest.index };
    }
    if (bracket.firstMissing === null && indexes.length === 0) {
      return { ...bracket.newest.answer, feedIndex: bracket.newest.index };
    }
    wanted = nextRound(bracket, gallop);
    if (bracket.firstMissing === null) {
      gallop *= 2 ** PARALLEL_READS;
    }
  }
}
