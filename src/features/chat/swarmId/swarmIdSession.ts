import { PrivateKey } from '@ethersphere/bee-js';
import { type ChatBinding, checkChatBinding, MAX_NAME_CHARACTERS } from '@solarpunkltd/swarm-chat-js/message';

import { shortAddress } from '@/shared/components/Address/addressText';

import { type Session, sessionFromKey } from '../auth/login';
import type { VerifyScope } from '../verify/verdicts';

import type { SwarmIdChatBinding, SwarmIdIdentity } from './swarmIdClient';

/** A viewer signed in with Swarm ID: the chat key the ID gave this site, and the binding that names its address. */
export interface SwarmIdSession extends Session {
  binding: ChatBinding;
  /** The Swarm ID account's own name, shown beside the chat name. */
  accountName: string;
}

/**
 * The chat library spells the binding `{ msg, sig }` and the Swarm ID library `{ message, signature }`. The signature
 * is lower-cased because the chat library reads one spelling only, and the case of hex digits signs nothing.
 */
function toChatBinding({ message, signature }: SwarmIdChatBinding): ChatBinding {
  return { msg: message, sig: signature.toLowerCase() };
}

/**
 * The account's name as a chat name: trimmed, and cut to the chat's limit counted in characters as a reader sees them.
 * An account with no name chats under its short address, so a sender line is never empty.
 */
export function chatNameOf(identity: SwarmIdIdentity): string {
  const name = [...identity.name.trim()].slice(0, MAX_NAME_CHARACTERS).join('').trim();
  if (name) {
    return name;
  }
  return shortAddress(identity.address);
}

type SwarmIdSessionResult = { ok: true; session: SwarmIdSession } | { ok: false; problem: string };

export const BINDING_REFUSED = 'Swarm ID confirmed a chat address that is not the one it gave this site.';
export const ACCOUNT_MISMATCH = 'Swarm ID confirmed this chat address for another account than the one signed in.';

/** The chat library names an account `0x` and lower case, the Swarm ID library as bare hex. */
function accountOf(identity: SwarmIdIdentity): string {
  return `0x${identity.address.replace(/^0x/i, '').toLowerCase()}`;
}

/**
 * The session a signed-in viewer chats with. The binding is checked as every reader will check it, for this page's
 * origin and this key's address, so a viewer is never signed in to send messages the chat would refuse. Its signer
 * must also be the account the frame says is signed in, so the badge names who the person picked.
 */
export function swarmIdSession(
  identity: SwarmIdIdentity,
  binding: SwarmIdChatBinding,
  chatKey: Uint8Array,
  scope: VerifyScope,
): SwarmIdSessionResult {
  const session = sessionFromKey(chatNameOf(identity), new PrivateKey(chatKey));
  const chatBinding = toChatBinding(binding);
  const check = checkChatBinding(chatBinding, session.address, scope);
  if (!check.ok) {
    return { ok: false, problem: BINDING_REFUSED };
  }
  if (check.identity.account !== accountOf(identity)) {
    return { ok: false, problem: ACCOUNT_MISMATCH };
  }
  return { ok: true, session: { ...session, binding: chatBinding, accountName: identity.name.trim() } };
}
