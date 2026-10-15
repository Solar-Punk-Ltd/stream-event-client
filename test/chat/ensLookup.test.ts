import { describe, expect, it } from 'vitest';

import { createEnsNames, hasNonAsciiCharacters } from '../../src/features/chat/ens/ensLookup';

const ENDPOINT = 'https://ethereum-rpc.example.org';
const WALLET = '0x5cbdd86a2fa8dc4bddd8a8f69dba48572eec07fb';
const OTHER_WALLET = '0x' + 'e'.repeat(40);

/** A resolver that answers from a table and counts what it was asked, through which endpoint. */
function fakeResolver(names: Record<string, string | undefined>) {
  const asked: Array<{ wallet: string; rpcUrl: string }> = [];
  return {
    asked,
    resolve: async (wallet: string, rpcUrl: string) => {
      asked.push({ wallet, rpcUrl });
      return names[wallet];
    },
  };
}

describe("a sender's ENS name", () => {
  it('is looked up through the configured endpoint, and kept for the wallet once found', async () => {
    const resolver = fakeResolver({ [WALLET]: 'ida.eth' });
    const names = createEnsNames(ENDPOINT, resolver.resolve);

    expect(names.known(WALLET)).toBeUndefined();
    expect(await names.lookUp(WALLET)).toBe('ida.eth');
    expect(names.known(WALLET)).toBe('ida.eth');
    expect(await names.lookUp(WALLET.toUpperCase().replace('0X', '0x'))).toBe('ida.eth');
    expect(resolver.asked).toEqual([{ wallet: WALLET, rpcUrl: ENDPOINT }]);
  });

  it('is asked for once when many messages of one wallet ask together', async () => {
    const resolver = fakeResolver({ [WALLET]: 'ida.eth' });
    const names = createEnsNames(ENDPOINT, resolver.resolve);

    const answers = await Promise.all([names.lookUp(WALLET), names.lookUp(WALLET), names.lookUp(WALLET)]);

    expect(answers).toEqual(['ida.eth', 'ida.eth', 'ida.eth']);
    expect(resolver.asked).toHaveLength(1);
  });

  it('is not kept when there was none, so a later look asks the library again', async () => {
    const resolver = fakeResolver({});
    const names = createEnsNames(ENDPOINT, resolver.resolve);

    expect(await names.lookUp(OTHER_WALLET)).toBeUndefined();
    expect(await names.lookUp(OTHER_WALLET)).toBeUndefined();
    expect(names.known(OTHER_WALLET)).toBeUndefined();
    expect(resolver.asked).toHaveLength(2);
  });

  it('is no name when the lookup fails, and never a rejection', async () => {
    const names = createEnsNames(ENDPOINT, async () => {
      throw new Error('the library did not load');
    });

    await expect(names.lookUp(WALLET)).resolves.toBeUndefined();
  });
});

describe('a name with characters a reader may mistake', () => {
  it('is told apart from a name of plain ASCII', () => {
    expect(hasNonAsciiCharacters('ida.eth')).toBe(false);
    expect(hasNonAsciiCharacters('vitalik-2.eth')).toBe(false);
    expect(hasNonAsciiCharacters('іda.eth'), 'a Cyrillic і').toBe(true);
    expect(hasNonAsciiCharacters('🔥.eth')).toBe(true);
  });
});
