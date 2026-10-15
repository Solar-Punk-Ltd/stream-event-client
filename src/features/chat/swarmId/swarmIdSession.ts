import { PrivateKey } from '@ethersphere/bee-js';
import {
  type ChatBinding,
  checkChatBinding,
  checkWalletLink,
  displayNameProblem,
  MAX_NAME_CHARACTERS,
  type WalletLink,
} from '@solarpunkltd/swarm-chat-js/message';

import { shortAddress } from '@/shared/components/Address/addressText';

import { type Session, sessionFromKey } from '../auth/login';
import type { VerifyScope } from '../verify/verdicts';

import type { SwarmIdChatBinding, SwarmIdIdentity, SwarmIdWalletLink } from './swarmIdClient';

/** A viewer signed in with Swarm ID: the chat key the ID gave this site, and the binding that names its address. */
export interface SwarmIdSession extends Session {
  binding: ChatBinding;
  /** The Swarm ID account's own name, shown beside the chat name where the two differ. */
  accountName: string;
  /** The Swarm ID account that signed the binding, `0x` and 40 lowercase hex characters. */
  account: string;
}

/**
 * The chat library spells the binding `{ msg, sig }` and the Swarm ID library `{ message, signature }`. The signature
 * is lower-cased because the chat library reads one spelling only, and the case of hex digits signs nothing.
 */
function toChatBinding({ message, signature }: SwarmIdChatBinding): ChatBinding {
  return { msg: message, sig: signature.toLowerCase() };
}

/** The chat library spells the wallet link `{ msg, wsig, asig }`, and reads its signatures in lower case only. */
function toChatWalletLink({ message, walletSignature, accountSignature }: SwarmIdWalletLink): WalletLink {
  return { msg: message, wsig: walletSignature.toLowerCase(), asig: accountSignature.toLowerCase() };
}

/**
 * The wallet link to send, checked as every reader will check it, for the account the binding names. A link that
 * fails is left out rather than sent, since every reader would refuse each message that carried it.
 */
function walletLinkFor(identity: SwarmIdIdentity, account: string): WalletLink | null {
  if (!identity.walletLink) {
    return null;
  }
  const link = toChatWalletLink(identity.walletLink);
  return checkWalletLink(link, account).ok ? link : null;
}

/**
 * The account's name as a chat name: trimmed, and cut to the chat's limit counted in characters as a reader sees them.
 * An account with no name, or one with a character the chat refuses in a name, chats under its short address, so a
 * sender line is never empty and every message is one the chat accepts.
 */
export function chatNameOf(identity: SwarmIdIdentity): string {
  const name = [...identity.name.trim()].slice(0, MAX_NAME_CHARACTERS).join('').trim();
  if (name && displayNameProblem(name) === null) {
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
  const walletLink = walletLinkFor(identity, check.identity.account);
  return {
    ok: true,
    session: {
      ...session,
      binding: chatBinding,
      ...(walletLink ? { walletLink } : {}),
      accountName: identity.name.trim(),
      account: check.identity.account,
    },
  };
}
