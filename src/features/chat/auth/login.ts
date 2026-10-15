import { PrivateKey } from '@ethersphere/bee-js';
import type { ChatBinding, WalletLink } from '@solarpunkltd/swarm-chat-js';

export const DISPLAY_NAME_MAX_LENGTH = 20;

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

export const DISPLAY_NAME_PROBLEM = `A display name is 1 to ${DISPLAY_NAME_MAX_LENGTH} characters.`;

export const INVISIBLE_CHARACTERS_PROBLEM = 'A display name cannot hold invisible formatting or control characters.';

/**
 * Unicode format and control characters, which draw nothing yet change how a name reads: a right-to-left override can
 * make one name look like another. The chat library refuses a message whose name holds one.
 */
const INVISIBLE_CHARACTER = /[\p{Cf}\p{Cc}]/u;

/** Whether `name` holds a character that draws nothing yet changes how the name around it reads. */
export function hasInvisibleCharacters(name: string): boolean {
  return INVISIBLE_CHARACTER.test(name);
}

/** Counted in characters as a reader sees them, so an emoji is one and not the two code units it takes. */
export function checkDisplayName(raw: string): DisplayNameCheck {
  const name = raw.trim();
  const length = [...name].length;
  if (length < 1 || length > DISPLAY_NAME_MAX_LENGTH) {
    return { ok: false, problem: DISPLAY_NAME_PROBLEM };
  }
  return hasInvisibleCharacters(name) ? { ok: false, problem: INVISIBLE_CHARACTERS_PROBLEM } : { ok: true, name };
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
