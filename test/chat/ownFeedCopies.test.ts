import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COPIED,
  NOT_COPIED,
  OWN_COPY_ATTEMPTS,
  OWN_COPY_RETRY_MS,
  ownFeedCopies,
} from '../../src/features/chat/stamp/ownFeedCopies';

const bytes = (label: string) => new TextEncoder().encode(label);
const text = (payload: Uint8Array) => new TextDecoder().decode(payload);

/** An own feed whose lookups and writes answer as the test says, logging every write by index. */
function feed(newest = 0) {
  const writes: Array<{ index: number; payload: string }> = [];
  const state = { lookups: 0, lookupFails: 0, writeFails: 0 };
  const places = {
    nextIndex: async () => {
      state.lookups++;
      if (state.lookupFails > 0) {
        state.lookupFails--;
        throw new Error('the lookup did not answer');
      }
      return newest;
    },
    writeAt: async (index: number, payload: Uint8Array) => {
      writes.push({ index, payload: text(payload) });
      if (state.writeFails > 0) {
        state.writeFails--;
        throw new Error('the write did not answer');
      }
    },
  };
  /** Every index written to holds one copy only, whatever was tried there. */
  const contentsByIndex = () => {
    const byIndex = new Map<number, Set<string>>();
    for (const { index, payload } of writes) {
      byIndex.set(index, (byIndex.get(index) ?? new Set()).add(payload));
    }
    return byIndex;
  };
  return { places, writes, state, contentsByIndex, copies: ownFeedCopies(places) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("copies in the sender's own feed", () => {
  it('are written at the next index, looked up once and counted on from there', async () => {
    const own = feed(5);
    expect(await own.copies.copyBeside('a', bytes('A'))).toBe(COPIED);
    expect(await own.copies.copyBeside('b', bytes('B'))).toBe(COPIED);
    expect(own.writes).toEqual([
      { index: 5, payload: 'A' },
      { index: 6, payload: 'B' },
    ]);
    expect(own.state.lookups).toBe(1);
  });

  it('try a lookup that fails three times in all, a few seconds apart, then stop', async () => {
    const own = feed();
    own.state.lookupFails = 10;
    const outcome = own.copies.copyBeside('a', bytes('A'));

    await vi.advanceTimersByTimeAsync(0);
    expect(own.state.lookups).toBe(1);
    await vi.advanceTimersByTimeAsync(OWN_COPY_RETRY_MS);
    expect(own.state.lookups).toBe(2);
    await vi.advanceTimersByTimeAsync(OWN_COPY_RETRY_MS);
    expect(await outcome).toBe(NOT_COPIED);
    expect(own.state.lookups).toBe(OWN_COPY_ATTEMPTS);
    await vi.advanceTimersByTimeAsync(10 * OWN_COPY_RETRY_MS);
    expect(own.state.lookups).toBe(OWN_COPY_ATTEMPTS);
    expect(own.writes).toEqual([]);
  });

  it('try a write that failed again at the same index with the same bytes', async () => {
    const own = feed();
    own.state.writeFails = 2;
    const outcome = own.copies.copyBeside('a', bytes('A'));
    await vi.advanceTimersByTimeAsync(2 * OWN_COPY_RETRY_MS);

    expect(await outcome).toBe(COPIED);
    expect(own.writes).toEqual([
      { index: 0, payload: 'A' },
      { index: 0, payload: 'A' },
      { index: 0, payload: 'A' },
    ]);
  });

  it('are tried once beside a message, however often the chat sends it again', async () => {
    const own = feed();
    own.state.writeFails = OWN_COPY_ATTEMPTS;
    const first = own.copies.copyBeside('a', bytes('A'));
    await vi.advanceTimersByTimeAsync(2 * OWN_COPY_RETRY_MS);
    expect(await first).toBe(NOT_COPIED);

    expect(await own.copies.copyBeside('a', bytes('A'))).toBe(NOT_COPIED);
    await vi.advanceTimersByTimeAsync(10 * OWN_COPY_RETRY_MS);
    expect(own.writes).toHaveLength(OWN_COPY_ATTEMPTS);
  });

  it('never put a second copy at an index a failed write may have reached, and keep the feed without a gap', async () => {
    const own = feed();
    own.state.writeFails = OWN_COPY_ATTEMPTS;
    const given = own.copies.copyBeside('a', bytes('A'));
    await vi.advanceTimersByTimeAsync(2 * OWN_COPY_RETRY_MS);
    expect(await given).toBe(NOT_COPIED);

    expect(await own.copies.copyBeside('b', bytes('B'))).toBe(COPIED);

    expect(own.writes.slice(OWN_COPY_ATTEMPTS)).toEqual([
      { index: 0, payload: 'A' },
      { index: 1, payload: 'B' },
    ]);
    for (const contents of own.contentsByIndex().values()) {
      expect(contents.size).toBe(1);
    }
  });

  it('give up the next copy too while the index before it cannot be written, and write nothing else there', async () => {
    const own = feed();
    own.state.writeFails = 2 * OWN_COPY_ATTEMPTS;
    const given = own.copies.copyBeside('a', bytes('A'));
    await vi.advanceTimersByTimeAsync(2 * OWN_COPY_RETRY_MS);
    const next = own.copies.copyBeside('b', bytes('B'));
    await vi.advanceTimersByTimeAsync(2 * OWN_COPY_RETRY_MS);

    expect([await given, await next]).toEqual([NOT_COPIED, NOT_COPIED]);
    expect(own.writes.every(({ index, payload }) => index === 0 && payload === 'A')).toBe(true);
  });

  it('are written again when the viewer asks, after the copy beside the message was given up', async () => {
    const own = feed();
    own.state.writeFails = OWN_COPY_ATTEMPTS;
    const given = own.copies.copyBeside('a', bytes('A'));
    await vi.advanceTimersByTimeAsync(2 * OWN_COPY_RETRY_MS);
    expect(await given).toBe(NOT_COPIED);

    expect(await own.copies.copy('a', bytes('A'))).toBe(COPIED);
    expect(await own.copies.copy('a', bytes('A')), 'a copy written once is not written again').toBe(COPIED);
    expect(own.writes).toHaveLength(OWN_COPY_ATTEMPTS + 1);
    expect(own.writes.at(-1)).toEqual({ index: 0, payload: 'A' });
  });

  it('are written one at a time, so two quick messages never take one index', async () => {
    const own = feed();
    const outcomes = await Promise.all([
      own.copies.copyBeside('a', bytes('A')),
      own.copies.copyBeside('b', bytes('B')),
      own.copies.copyBeside('c', bytes('C')),
    ]);
    expect(outcomes).toEqual([COPIED, COPIED, COPIED]);
    expect(own.writes.map(({ index }) => index)).toEqual([0, 1, 2]);
    expect(own.state.lookups).toBe(1);
  });
});
