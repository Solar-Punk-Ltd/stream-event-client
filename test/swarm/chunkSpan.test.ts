import { Span } from '@ethersphere/bee-js';
import { describe, expect, it } from 'vitest';

import { bodyLengthOf, storedSpanOf } from '../../src/swarm/chunkSpan';

const LENGTH = 4567n;

/** A span of {@link LENGTH} with `topByte` in its top byte, then a payload byte, the way a chunk starts. */
function chunkWithTopByte(topByte: number): Uint8Array {
  const span = Span.fromBigInt(LENGTH | (BigInt(topByte) << 56n)).toUint8Array();
  return Uint8Array.from([...span, 0xaa]);
}

describe("a chunk's span", () => {
  it.each([
    { topByte: 0x00, coded: false },
    { topByte: 0x7f, coded: false },
    { topByte: 0x80, coded: false },
    { topByte: 0x81, coded: true },
    { topByte: 0x84, coded: true },
    { topByte: 0xff, coded: true },
  ])(
    'with top byte $topByte names the real length only below a redundancy level (coded: $coded)',
    ({ topByte, coded }) => {
      const stored = LENGTH | (BigInt(topByte) << 56n);
      const bytes = chunkWithTopByte(topByte);

      expect(storedSpanOf(bytes)).toBe(stored);
      expect(bodyLengthOf(bytes)).toBe(coded ? LENGTH : stored);
    },
  );

  it('is read at an offset, as a single-owner chunk carries it after its identifier and signature', () => {
    const bytes = Uint8Array.from([0x01, 0x02, ...chunkWithTopByte(0x81)]);

    expect(bodyLengthOf(bytes, 2)).toBe(LENGTH);
    expect(storedSpanOf(bytes, 2)).toBe(LENGTH | (0x81n << 56n));
  });
});
