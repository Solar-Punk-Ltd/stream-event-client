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

describe('a later search, from the newest entry found before', () => {
  it.each<[string, number[], number, number | string, number]>([
    ['a feed that has not moved, one round', upTo(300), 300, 300, 8],
    ['a feed that grew by three, one round', upTo(303), 300, 303, 8],
    ['a feed that grew by four, one round', upTo(304), 300, 304, 8],
    ['a feed that grew by five, two rounds', upTo(305), 300, 305, 16],
    ['a feed that grew far, galloping on from there', upTo(900), 300, 900, 56],
    ['a head that went back below what was found, searched again from scratch', upTo(120), 300, 120, 50],
    ['a feed that is gone, not found', [], 300, 'not-found', 16],
  ])('%s', async (_, entries, from, expected, mostReads) => {
    const feed = feedOf(entries);

    expect(indexOf(await findNewestEntry(feed.read, from))).toBe(expected);
    expect(feed.asked.length).toBeLessThanOrEqual(mostReads);
  });

  it('asks the entry found before and the ones just above it first', async () => {
    const feed = feedOf(upTo(300));

    await findNewestEntry(feed.read, 300);

    expect(feed.asked.slice(0, 3)).toEqual([300, 301, 302]);
  });
});
