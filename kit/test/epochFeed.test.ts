import { describe, expect, it } from 'vitest';

import { EpochIndex, epochPointer, findLatestPointer, MAX_LEVEL } from '../src/epochFeed.ts';

const timestamp = (seconds: number) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(seconds), false);
  return bytes;
};

describe('epochPointer', () => {
  const address = new Uint8Array(32).fill(0xaa);
  const key = new Uint8Array(32).fill(0xbb);

  it('reads an encrypted reference, whose second half is the key that opens the data', () => {
    const pointer = epochPointer(new Uint8Array([...timestamp(7), ...address, ...key]));
    expect(pointer).toEqual({ timestamp: 7n, address: 'aa'.repeat(32), key: 'bb'.repeat(32) });
  });

  it('reads a plain reference as one with no key, and a span-prefixed payload the same way', () => {
    expect(epochPointer(new Uint8Array([...timestamp(7), ...address]))).toEqual({
      timestamp: 7n,
      address: 'aa'.repeat(32),
      key: null,
    });
    const span = new Uint8Array(8);
    expect(epochPointer(new Uint8Array([...span, ...timestamp(9), ...address, ...key]))?.key).toBe('bb'.repeat(32));
  });

  it('refuses a payload of any other length', () => {
    expect(epochPointer(new Uint8Array(41))).toBeNull();
  });
});

describe('findLatestPointer', () => {
  it('walks from the root epoch down to the newest leaf at or before the time asked', async () => {
    // A feed written at 100 and then at 130: the first update takes the root epoch, the second the epoch under it.
    const root = new EpochIndex(0n, MAX_LEVEL);
    const second = root.childAt(130n);
    const written = new Map([
      [root.toString(), 'first'],
      [second.toString(), 'second'],
    ]);
    const found = await findLatestPointer(130n, async (epoch) => written.get(epoch.toString()));
    expect(found).toBe('second');
  });

  it('answers nothing for a feed never written', async () => {
    expect(await findLatestPointer(130n, async () => undefined)).toBeUndefined();
  });
});
