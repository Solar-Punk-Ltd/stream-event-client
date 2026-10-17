/** An address or key as hex with no `0x` and in lower case, so two spellings of one value compare equal. */
export function bareHex(value: string): string {
  return value.toLowerCase().replace(/^0x/, '');
}
