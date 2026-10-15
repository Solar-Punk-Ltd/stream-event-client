/** How many hex digits the short form keeps at each end. */
const KEPT_DIGITS = 4;
const HEX_PREFIX = /^0x/i;

/** A hex value, an address or a signature, spelled with one `0x` whether or not it came with one. */
export function fullAddress(hex: string): string {
  return `0x${hex.replace(HEX_PREFIX, '')}`;
}

/**
 * A hex value as people read it at a glance, `0x0d7f…ab12`: `0x`, the first and the last four digits. A value with
 * too few digits to shorten is left whole.
 */
export function shortAddress(hex: string): string {
  const digits = hex.replace(HEX_PREFIX, '');
  if (digits.length <= 2 * KEPT_DIGITS + 1) {
    return `0x${digits}`;
  }
  return `0x${digits.slice(0, KEPT_DIGITS)}…${digits.slice(-KEPT_DIGITS)}`;
}
