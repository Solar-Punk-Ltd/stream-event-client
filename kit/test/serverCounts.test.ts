import { describe, expect, it } from 'vitest';

import { countProblems, countsOf, replayOutcome, type ServerCounts } from '../src/serverCounts.ts';

const counts = (received: number, dropped: Record<string, number> = {}): ServerCounts => ({ received, dropped });

describe('countProblems', () => {
  it('passes when received rose by the writes and each reason by the number forged for it', () => {
    const before = counts(10, { binding: 1 });
    const after = counts(13, { binding: 2, signature: 2 });
    expect(countProblems(before, after, { received: 3, dropped: { signature: 2, binding: 1 } })).toEqual([]);
  });

  it('names a write the server never received, which a rise of the drops alone would hide', () => {
    expect(countProblems(counts(10), counts(11, { signature: 1 }), { received: 2, dropped: { signature: 1 } })).toEqual(
      ['the server received 1 of the 2 writes'],
    );
  });

  it('names a reason that rose by more or less than the number forged for it', () => {
    expect(
      countProblems(counts(0, { signature: 1 }), counts(2, { signature: 2 }), {
        received: 2,
        dropped: { signature: 2 },
      }),
    ).toEqual(['the server dropped 1 as signature, not 2']);
    expect(countProblems(counts(0), counts(2, { signature: 3 }), { received: 2, dropped: { signature: 2 } })).toEqual([
      'the server dropped 3 as signature, not 2',
    ]);
  });

  it('names a write dropped for a reason that was not forged', () => {
    expect(
      countProblems(counts(0), counts(1, { signature: 1, 'rate-sender': 1 }), {
        received: 1,
        dropped: { signature: 1 },
      }),
    ).toEqual(['the server dropped 1 as rate-sender, which nothing forged']);
  });

  it('leaves out the server dropping its own heartbeats, which are not writes and never count as received', () => {
    const before = counts(0, { 'heartbeat-repeat': 4 });
    const after = counts(1, { signature: 1, 'heartbeat-repeat': 5, 'heartbeat-unknown': 1 });
    expect(countProblems(before, after, { received: 1, dropped: { signature: 1 } })).toEqual([]);
  });
});

describe('replayOutcome', () => {
  it('reads two received and one duplicate as the server refusing the repeat', () => {
    expect(replayOutcome(counts(5, { duplicate: 1 }), counts(7, { duplicate: 2 }))).toEqual({
      outcome: 'the server dropped the repeat as a duplicate',
    });
  });

  it('reads one received and no duplicate as Bee never handing the identical chunk over again', () => {
    expect(replayOutcome(counts(5), counts(6))).toEqual({
      outcome: 'Bee did not hand the identical chunk over a second time, so the repeat never reached the server',
    });
  });

  it('names anything else as a problem, since neither closes the replay', () => {
    expect(replayOutcome(counts(5), counts(7))).toEqual({
      problem: 'the server received 2 writes and dropped 0 as duplicate, so the repeat was taken as new',
    });
    expect(replayOutcome(counts(5), counts(5))).toEqual({
      problem: 'the server received 0 writes and dropped 0 as duplicate, so the first write never arrived',
    });
  });
});

describe('countsOf', () => {
  it('reads received and the drops by reason from the chat server health', () => {
    expect(countsOf({ counts: { received: 3, published: 2, heartbeats: 9, dropped: { duplicate: 1 } } })).toEqual({
      received: 3,
      dropped: { duplicate: 1 },
    });
    expect(countsOf({ counts: { received: 0 } })).toEqual({ received: 0, dropped: {} });
  });

  it('answers null for a body that is not the chat server health', () => {
    expect(countsOf(null)).toBeNull();
    expect(countsOf({ code: 404, message: 'Not Found' })).toBeNull();
    expect(countsOf({ counts: { received: 'x' } })).toBeNull();
  });
});
