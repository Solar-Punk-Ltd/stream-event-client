import { describe, expect, it } from 'vitest';

import type { SwarmAnswer } from '../../src/swarm/answers';
import { findNewestEntry } from '../../src/swarm/providers/weeb-3/newestEntrySearch';

/** A feed holding exactly the entries named, each read answering its own index as its bytes. */
function feedOf(entries: Iterable<number>) {
  const held = new Set(entries);
  const asked: number[] = [];
  const read = async (index: number): Promise<SwarmAnswer> => {
    asked.push(index);
    return held.has(index)
      ? { kind: 'content', bytes: new TextEncoder().encode(String(index)), feedIndex: null, serverTimeMs: null }
      : { kind: 'not-found', serverTimeMs: null };
  };
  return { read, asked };
}

const upTo = (newest: number) => Array.from({ length: newest + 1 }, (_, index) => index);

const indexOf = (answer: SwarmAnswer) => (answer.kind === 'content' ? answer.feedIndex : answer.kind);

describe("a feed's newest entry, found by reading entries by index", () => {
  it.each<[string, number[], number | string]>([
    ['an empty feed', [], 'not-found'],
    ['a feed of one entry', [0], 0],
    ['exactly eight entries', upTo(7), 7],
    ['a gap wider than eight between the first round reads', upTo(40), 40],
    ['a feed past the first round, found by galloping', upTo(20_000), 20_000],
    ['a hole near the head that a read lands in, which ends the search at the entry before it', [0, 1, 2, 4], 2],
    ['a hole near the head that the cuts step over, which still finds the head', [...upTo(9), 11, 12], 12],
    [
      'a hole below an entry the first round read, which is never the head',
      [...upTo(14).filter((i) => i !== 5), 15],
      15,
    ],
  ])('%s', async (_, entries, expected) => {
    expect(indexOf(await findNewestEntry(feedOf(entries).read))).toBe(expected);
  });
});
