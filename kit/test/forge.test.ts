import { PrivateKey } from '@ethersphere/bee-js';
import { parseChatMessage } from '@solarpunkltd/swarm-chat-js/message';
import { describe, expect, it } from 'vitest';
import { keccak256, toBytes, type Hex } from 'viem';

import {
  boundMessage,
  foreignBindingMessage,
  forgedWalletLinkMessage,
  guestMessage,
  personalSign,
  tamperedMessage,
  wrongAddressMessage,
} from '../src/forge.ts';

const TOPIC = 'chat-flow-kit-stream';
const ORIGIN = 'http://127.0.0.1:4180';
const key = (seed: string) => new PrivateKey(keccak256(toBytes(`flow-kit forge ${seed}`)).slice(2));
const hex = (seed: string): Hex => keccak256(toBytes(`flow-kit hex ${seed}`));
const check = (payload: Uint8Array) => parseChatMessage(payload, { origin: ORIGIN, allowLocalHttp: true });

describe('a plain forged guest message', () => {
  it('passes the server, since it is well formed and signed by the address it names', () => {
    expect(check(guestMessage(key('a'), TOPIC, 'hello'))).toMatchObject({ ok: true });
  });
});

describe('the server refuses a bad message', () => {
  it('a claimed address the signature was not made by is a signature failure', () => {
    const forged = wrongAddressMessage(key('a'), TOPIC, 'not mine', key('victim').publicKey().address().toHex());
    expect(check(forged)).toMatchObject({ ok: false, reason: 'signature' });
  });

  it('a body changed after signing is a signature failure', () => {
    expect(check(tamperedMessage(key('a'), TOPIC, 'start'))).toMatchObject({ ok: false, reason: 'signature' });
  });
});

describe('a binding', () => {
  it('for this site passes', async () => {
    expect(
      check(
        await boundMessage({ topic: TOPIC, text: 'bound', site: ORIGIN, accountKey: hex('acc'), chatKey: hex('chat') }),
      ),
    ).toMatchObject({
      ok: true,
      identity: { site: ORIGIN },
    });
  });

  it('for another site is refused as a binding', async () => {
    const forged = await foreignBindingMessage({
      topic: TOPIC,
      text: 'elsewhere',
      otherSite: 'http://localhost:4180',
      accountKey: hex('acc'),
      chatKey: hex('chat'),
    });
    expect(check(forged)).toMatchObject({ ok: false, reason: 'binding' });
  });
});

describe('a forged wallet link', () => {
  const base = {
    topic: TOPIC,
    text: 'show my name',
    site: ORIGIN,
    accountKey: hex('acc'),
    chatKey: hex('chat'),
    wallet: hex('wallet'),
    otherWallet: hex('other'),
  };

  it('is refused as a binding whether its wallet signature is high-s, another wallet, or for another account', async () => {
    for (const flaw of ['high-s', 'wrong-wallet', 'another-account'] as const) {
      const result = check(await forgedWalletLinkMessage({ ...base, flaw }));
      expect(result, flaw).toMatchObject({ ok: false, reason: 'binding' });
      if (!result.ok) expect(result.detail, flaw).toMatch(/wallet link/);
    }
  });
});

describe('personalSign', () => {
  it('is 65 bytes with v 27 or 28', async () => {
    const sig = await personalSign(hex('k'), 'hello');
    expect(sig).toMatch(/^0x[0-9a-f]{128}(1b|1c)$/);
  });
});
