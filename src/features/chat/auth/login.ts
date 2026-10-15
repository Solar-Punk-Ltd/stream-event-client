import { PrivateKey } from '@ethersphere/bee-js';
import {
  type ChatBinding,
  displayNameProblem,
  MAX_NAME_CHARACTERS,
  type WalletLink,
} from '@solarpunkltd/swarm-chat-js/message';

const KEY_LENGTH_BYTES = 32;

/** Who a viewer is in the chat: the name they chose and the key their messages are signed with. */
export interface Session {
  username: string;
  /** 64 hex digits, no 0x. */
  privateKey: string;
  /** The address the key signs as, 40 hex digits, no 0x. */
  address: string;
  /** A Swarm ID account's statement that `address` is its chat address on this site. Absent for a guest. */
  binding?: ChatBinding;
  /** The Swarm ID account's wallet link, present only while it shares one and it names the binding's account. */
  walletLink?: WalletLink;
}

export type DisplayNameCheck = { ok: true; name: string } | { ok: false; problem: string };

export const DISPLAY_NAME_PROBLEM = `A display name is 1 to ${MAX_NAME_CHARACTERS} characters.`;

export const INVISIBLE_CHARACTERS_PROBLEM = 'A display name cannot hold invisible formatting or control characters.';

/** Counted in characters as a reader sees them, so an emoji is one and not the two code units it takes. */
export function checkDisplayName(raw: string): DisplayNameCheck {
  const name = raw.trim();
  switch (displayNameProblem(name)) {
    case 'length':
      return { ok: false, problem: DISPLAY_NAME_PROBLEM };
    case 'invisible':
      return { ok: false, problem: INVISIBLE_CHARACTERS_PROBLEM };
    default:
      return { ok: true, name };
  }
}

export type RandomBytes = (length: number) => Uint8Array;

const browserRandomBytes: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

export function sessionFromKey(username: string, privateKey: PrivateKey): Session {
  return {
    username,
    privateKey: privateKey.toHex(),
    address: privateKey.publicKey().address().toHex(),
  };
}

/**
 * A new chat identity for this browser: the name checked, and a fresh key of 32 random bytes. There is
 * no account behind it, so the key proves only that two messages came from the same browser.
 */
export function nicknameLogin(nickname: string, randomBytes: RandomBytes = browserRandomBytes): Session {
  const checked = checkDisplayName(nickname);
  if (!checked.ok) {
    throw new Error(checked.problem);
  }
  return sessionFromKey(checked.name, new PrivateKey(randomBytes(KEY_LENGTH_BYTES)));
}
