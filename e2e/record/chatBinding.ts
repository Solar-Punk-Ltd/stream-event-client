import type { ChatBinding } from '@solarpunkltd/swarm-chat-js';
import { Elliptic } from 'cafe-utility';

/**
 * A Swarm ID chat binding as the Swarm ID fork signs one: four lines, signed by the account with EIP-191
 * personal_sign. The recording needs one for its own origin, which no Swarm ID ever signed for, so the recorder signs
 * it with a throwaway account of its own.
 */
export function signChatBinding(accountKey: Uint8Array, site: string, chatAddress: string, date: Date): ChatBinding {
  const msg = [
    'Swarm ID chat binding v1',
    `Site: ${site}`,
    `Chat address: 0x${chatAddress}`,
    `Date: ${date.toISOString()}`,
  ].join('\n');
  const body = new TextEncoder().encode(msg);
  const personal = new Uint8Array([
    ...new TextEncoder().encode(`\x19Ethereum Signed Message:\n${body.length}`),
    ...body,
  ]);
  const [r, s, v] = Elliptic.signMessage(personal, BigInt(`0x${Buffer.from(accountKey).toString('hex')}`));
  const hex = (value: bigint, digits: number) => value.toString(16).padStart(digits, '0');
  return { msg, sig: `0x${hex(r, 64)}${hex(s, 64)}${hex(v, 2)}` };
}

/** The account a key signs as, 0x and 40 lowercase hex characters, as a verified binding names it. */
export function accountOf(accountKey: Uint8Array): string {
  const publicKey = Elliptic.privateKeyToPublicKey(BigInt(`0x${Buffer.from(accountKey).toString('hex')}`));
  return `0x${Buffer.from(Elliptic.publicKeyToAddress(publicKey)).toString('hex')}`;
}
