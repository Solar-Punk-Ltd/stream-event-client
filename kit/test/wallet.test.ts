import { recoverMessageAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import { personalMessage, testWallet } from '../src/wallet.ts';

const KEY = `0x${'11'.repeat(32)}` as const;

describe('personalMessage', () => {
  it("signs Swarm ID's text message as text, recoverable to the wallet", async () => {
    const wallet = testWallet(KEY);
    const message = 'Swarm ID\n\nSign this message to encrypt your recovery phrase on this device.\n\nv1';
    const signature = await privateKeyToAccount(KEY).signMessage({ message: personalMessage(message) });
    expect(await recoverMessageAddress({ message, signature })).toBe(wallet.address);
  });

  it('signs a hex message as its bytes, as MetaMask reads it', () => {
    expect(personalMessage('0xdeadbeef')).toEqual({ raw: '0xdeadbeef' });
  });
});
