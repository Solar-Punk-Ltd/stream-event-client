import { describe, expect, it } from 'vitest';

import {
  createEnsNames,
  ENS_LOOKUPS_AT_ONCE,
  ENS_NAME_KEPT_MS,
  hasNonAsciiCharacters,
} from '../../src/features/chat/ens/ensLookup';

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

  it('is looked up for at most four wallets at a time', async () => {
    let inFlight = 0;
    let most = 0;
    const names = createEnsNames(ENDPOINT, async (wallet) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return `${wallet.slice(2, 6)}.eth`;
    });
    const wallets = Array.from({ length: 10 }, (_, at) => `0x${at.toString(16).repeat(40)}`);

    const answers = await Promise.all(wallets.map((wallet) => names.lookUp(wallet)));

    expect(answers).toEqual(wallets.map((wallet) => `${wallet.slice(2, 6)}.eth`));
    expect(ENS_LOOKUPS_AT_ONCE).toBe(4);
    expect(most).toBe(ENS_LOOKUPS_AT_ONCE);
  });

  it("is kept for ten minutes, the library's own expiry, so a name moved to another wallet shows", async () => {
    const table: Record<string, string | undefined> = { [WALLET]: 'ida.eth' };
    const resolver = fakeResolver(table);
    const clock = { now: 0 };
    const names = createEnsNames(ENDPOINT, resolver.resolve, () => clock.now);

    expect(await names.lookUp(WALLET)).toBe('ida.eth');
    table[WALLET] = undefined;
    clock.now += ENS_NAME_KEPT_MS;
    expect(names.known(WALLET)).toBe('ida.eth');
    clock.now += 1;
    expect(names.known(WALLET)).toBeUndefined();
    expect(await names.lookUp(WALLET)).toBeUndefined();
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
