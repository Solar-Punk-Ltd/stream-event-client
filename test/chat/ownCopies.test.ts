import { PrivateKey, Topic } from '@ethersphere/bee-js';
import {
  type ChatMessage,
  createChatMessage,
  encodeChatMessage,
  MessageType,
  MessageVia,
  ownFeedTopic,
} from '@solarpunkltd/swarm-chat-js';
import { describe, expect, it } from 'vitest';

import type { ChatReads } from '../../src/features/chat/chatParts';
import { OwnCopiesUnreadableError, readOwnCopies } from '../../src/features/chat/stamp/ownCopies';
import { NOT_FOUND, ownFeed, socBytes } from '../helpers/ownFeed';
import { GUEST_KEY, idOf, inThreadVerifier } from '../helpers/signedChat';

const CHAT_TOPIC = 'chat-stream-one';
const OWNER = new PrivateKey(GUEST_KEY).publicKey().address().toHex();
const TOPIC = Topic.fromString(ownFeedTopic(CHAT_TOPIC));

function copy(index: number, fields: { topic?: string } = {}): ChatMessage {
  return createChatMessage(GUEST_KEY, {
    id: idOf(`copy-${index}`),
    topic: fields.topic ?? CHAT_TOPIC,
    type: MessageType.TEXT,
    text: `copy ${index}`,
    name: 'Ada',
    ts: 1_000 + index,
    via: MessageVia.OWN_STAMP,
    own: true,
  }).message;
}

/** An own feed of `payloads`, at indices 0 and on, read through a chat reader that logs every read. */
function feed(payloads: Uint8Array[]) {
  const own = ownFeed(GUEST_KEY, CHAT_TOPIC, payloads);
  return { ...own, reads: () => own.reads };
}

const encoded = (message: ChatMessage) => encodeChatMessage(message);
const texts = (page: Awaited<ReturnType<typeof readOwnCopies>>) => page.copies.map(({ message }) => message.text);

const options = (reads: () => ChatReads) => ({
  reads,
  verify: inThreadVerifier(),
  owner: OWNER,
  chatTopic: CHAT_TOPIC,
  count: 3,
  timeoutMs: 1_000,
});

describe("a sender's own copies, as the message details read them", () => {
  it("reads the sender's own feed newest first, a bounded number at a time, and then the ones before", async () => {
    const own = feed([0, 1, 2, 3, 4].map((index) => encoded(copy(index))));

    const first = await readOwnCopies({ ...options(own.reads), from: null });
    expect(texts(first)).toEqual(['copy 4', 'copy 3', 'copy 2']);
    expect(first.copies.map(({ index }) => index)).toEqual([4, 3, 2]);
    expect(first.nextIndex).toBe(1);
    expect(own.asked[0]).toBe(`head ${OWNER} ${TOPIC.toHex()}`);

    const second = await readOwnCopies({ ...options(own.reads), from: first.nextIndex });
    expect(texts(second)).toEqual(['copy 1', 'copy 0']);
    expect(second.nextIndex).toBeNull();
  });

  it('hides a copy that fails its check, or belongs to another chat or sender, and counts it', async () => {
    const tampered = { ...copy(1), text: 'changed after signing' };
    const otherChat = copy(2, { topic: 'chat-another-stream' });
    const someoneElse = createChatMessage('b2'.repeat(32), {
      topic: CHAT_TOPIC,
      type: MessageType.TEXT,
      text: 'not theirs',
      name: 'Bea',
      via: MessageVia.OWN_STAMP,
      own: true,
    }).message;
    const own = feed([encoded(copy(0)), encoded(tampered), encoded(otherChat), encoded(someoneElse), encoded(copy(4))]);

    const page = await readOwnCopies({ ...options(own.reads), count: 5, from: null });

    expect(texts(page)).toEqual(['copy 4', 'copy 0']);
    expect(page.hidden).toBe(3);
  });

  it('hides a slot whose chunk is not the sender’s own', async () => {
    const own = feed([encoded(copy(0)), encoded(copy(1))]);
    own.chunks.set(own.addressAt(0), socBytes(new PrivateKey('c3'.repeat(32)), own.identifierAt(0), encoded(copy(0))));

    const page = await readOwnCopies({ ...options(own.reads), from: null });

    expect(texts(page)).toEqual(['copy 1']);
    expect(page.hidden).toBe(1);
  });

  it('has none for a sender who keeps no own feed yet', async () => {
    const page = await readOwnCopies({ ...options(feed([]).reads), from: null });
    expect(page).toEqual({ copies: [], nextIndex: null, hidden: 0 });
  });

  it('says so when the feed cannot be read, rather than showing none', async () => {
    const reads: ChatReads = {
      readFeedHead: async () => ({ kind: 'unavailable', cause: { kind: 'timeout', timeoutMs: 1_000 } }),
      readChunk: async () => NOT_FOUND,
      readBytes: async () => NOT_FOUND,
    };
    await expect(readOwnCopies({ ...options(() => reads), from: null })).rejects.toBeInstanceOf(
      OwnCopiesUnreadableError,
    );
  });
});
