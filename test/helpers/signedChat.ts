import { PrivateKey } from '@ethersphere/bee-js';
import {
  type ChatBinding,
  type ChatMessage,
  createChatMessage,
  type MessageData,
  MessageType,
  MessageVia,
  signedBytes,
  type UnsignedChatMessage,
} from '@solarpunkltd/swarm-chat-js';

import { createMessageVerifier, type VerifierPort } from '../../src/features/chat/verify/messageVerifier';
import { type VerifiedBatch, verifyBatch, type VerifyRequest } from '../../src/features/chat/verify/verdicts';

/**
 * Chat bindings made by the Swarm ID fork for its test account, as swarm-chat-js 8 keeps them in
 * `test/bindingVectors.ts`. The account key below holds nothing, and the chat key it gives a site is derived rather
 * than written down, the way the fork derives it.
 */
const FORK_ACCOUNT_KEY = '22'.repeat(32);
export const FORK_ACCOUNT = '0x1563915e194d8cfba1943570603f7606a3115508';

export const BOUND_SITE = 'https://example.com';

export const CHAT_BINDING: ChatBinding = {
  msg: 'Swarm ID chat binding v1\nSite: https://example.com\nChat address: 0xa531fcf12e72328748c12ba58b2b023c00e9a8f9\nDate: 2026-10-14T12:00:00.000Z',
  sig: '0x81b66b5a35aac1203c8c19883c40965e1eaee71ba57df28d3465cb8e03cf4263297bc64b2e5db5d815ae4ebb504f0a8c36ead8193bb13cd44138b2de44642c7d1c',
};

export const OTHER_SITE = 'https://other.example';

export const OTHER_SITE_BINDING: ChatBinding = {
  msg: 'Swarm ID chat binding v1\nSite: https://other.example\nChat address: 0x7dbe2d309740e55abeb818365acf15bc95cd211a\nDate: 2026-10-14T12:00:00.000Z',
  sig: '0xb41bf4bc3623511e462c947495147dc32a651574884182ca6ae85a5374b5529c3a8a12fe082c32c4956662501f49d7810937e2ce7283450c4d801409187f9a301c',
};

/** HMAC-SHA256 of the site under the account key, the fork's `deriveSecret`, as the library's tests derive it. */
export async function chatKeyFor(site: string): Promise<string> {
  const keyBytes = Uint8Array.from(FORK_ACCOUNT_KEY.match(/../g) ?? [], (pair) => parseInt(pair, 16));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const secret = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(site)));
  return Array.from(secret, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Guest keys for tests. Each holds nothing and is a repeated byte, so no key-shaped literal is kept. */
export const GUEST_KEY = 'a1'.repeat(32);
export const SECOND_GUEST_KEY = 'b2'.repeat(32);

export const TEST_TOPIC = 'chat-stream-one';

export function addressOf(key: string): string {
  return new PrivateKey(key).publicKey().address().toHex();
}

/** A readable label as the 32 hex digits of a message id, so a test names messages by what they are. */
export function idOf(label: string): string {
  const hex = Array.from(new TextEncoder().encode(label), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hex.length > 32) {
    throw new Error(`a message label is at most 16 bytes, "${label}" is not`);
  }
  return hex.padEnd(32, '0');
}

export interface SignedFields {
  key?: string;
  topic?: string;
  type?: MessageType;
  target?: string;
  text?: string;
  name?: string;
  ts?: number;
  via?: MessageVia;
  binding?: ChatBinding;
}

export function signedMessage(label: string, fields: SignedFields = {}): ChatMessage {
  return createChatMessage(fields.key ?? GUEST_KEY, {
    id: idOf(label),
    topic: fields.topic ?? TEST_TOPIC,
    type: fields.type ?? MessageType.TEXT,
    ...(fields.target ? { target: fields.target } : {}),
    text: fields.text ?? `text of ${label}`,
    name: fields.name ?? 'Bea',
    ts: fields.ts ?? 1_000,
    via: fields.via ?? MessageVia.GATEWAY,
    ...(fields.binding ? { idb: fields.binding } : {}),
  }).message;
}

/**
 * A message signed by `key` whatever its binding says, the way a forger would. The library refuses to build one whose
 * binding is not for its key, so it is put together by hand.
 */
export function forgedWithBinding(label: string, key: string, binding: ChatBinding): ChatMessage {
  const unsigned: UnsignedChatMessage = {
    v: 8,
    topic: TEST_TOPIC,
    id: idOf(label),
    type: MessageType.TEXT,
    target: '',
    text: `text of ${label}`,
    name: 'Mallory',
    addr: addressOf(key),
    ts: 1_000,
    via: MessageVia.GATEWAY,
    own: false,
    idb: binding,
  };
  return { ...unsigned, sig: new PrivateKey(key).sign(signedBytes(unsigned)).toHex() };
}

/** The event the library emits for a message, as its own `publishedMessageData` builds one. */
export function messageData(message: ChatMessage, index: number, timestamp = message.ts): MessageData {
  return {
    id: message.id,
    type: message.type,
    message: message.text,
    username: message.name,
    address: message.addr,
    timestamp,
    ...(message.target ? { targetMessageId: message.target } : {}),
    index,
    signedMessage: message,
  };
}

/**
 * The worker's own handler answering on the page's thread, a microtask after each batch is posted, as a worker answers
 * after the page has carried on. jsdom has no Web Worker, and everything but the thread is the same.
 */
export function inThreadPort(): VerifierPort & { posted: VerifyRequest[] } {
  const port: VerifierPort & { posted: VerifyRequest[] } = {
    posted: [],
    onmessage: null,
    onerror: null,
    postMessage(request: VerifyRequest) {
      port.posted.push(request);
      queueMicrotask(() => {
        const answer: VerifiedBatch = verifyBatch(request);
        port.onmessage?.({ data: answer } as MessageEvent<VerifiedBatch>);
      });
    },
  };
  return port;
}

export function inThreadVerifier(origin: string = BOUND_SITE) {
  return createMessageVerifier(inThreadPort(), { origin, allowLocalHttp: false });
}
