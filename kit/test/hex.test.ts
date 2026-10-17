import { describe, expect, it } from 'vitest';

import { bareHex } from '../src/hex.ts';

describe('bareHex', () => {
  it('drops the 0x and lower-cases, so two spellings of one address compare equal', () => {
    expect(bareHex('0xAbCd')).toBe('abcd');
    expect(bareHex('abcd')).toBe('abcd');
    expect(bareHex('0XABCD')).toBe('abcd');
  });
});
