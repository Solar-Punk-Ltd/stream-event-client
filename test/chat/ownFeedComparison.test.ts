import { type ChatMessage, createChatMessage, MessageType, MessageVia } from '@solarpunkltd/swarm-chat-js';
import { describe, expect, it } from 'vitest';

import {
  compareOwnFeed,
  isInOwnFeed,
  MAX_HISTORY_FILES,
  MAX_OWN_FEED_ENTRIES,
  OWN_FEED_MARGIN,
  OwnFeedTooLargeError,
  OwnFeedUnreadableError,
} from '../../src/features/chat/stamp/ownFeedComparison';
import type { SwarmAnswer } from '../../src/swarm/answers';
import { servedFeeds } from '../helpers/chatFeed';
import { addressOf, GUEST_KEY, idOf, inThreadVerifier, SECOND_GUEST_KEY } from '../helpers/signedChat';

const CHAT_TOPIC = 'chat-stream-one';
const SERVER_KEY = 'c3'.repeat(32);
const SENDER = addressOf(GUEST_KEY);

function message(label: string, key = GUEST_KEY): ChatMessage {
  return createChatMessage(key, {
    id: idOf(label),
    topic: CHAT_TOPIC,
    type: MessageType.TEXT,
    text: `text of ${label}`,
    name: 'Ada',
    ts: 1_000,
    via: MessageVia.OWN_STAMP,
  }).message;
}

const compare = (feeds: ReturnType<typeof servedFeeds>) =>
  compareOwnFeed({
    reads: () => feeds.reads,
    verify: inThreadVerifier(),
    chatOwner: addressOf(SERVER_KEY),
    chatTopic: CHAT_TOPIC,
    sender: SENDER,
    timeoutMs: 1_000,
  });

const ids = (records: ReadonlyArray<{ message: ChatMessage }>) => records.map(({ message }) => message.id);

describe("comparing a sender's own feed with the chat", () => {
  it("counts the sender's messages in the whole chat and the copies in their own feed, and names what each side lacks", async () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((label) => message(label));
    const someoneElse = message('other', SECOND_GUEST_KEY);
    const feeds = servedFeeds();
    feeds.chat(SERVER_KEY, CHAT_TOPIC, [a!, someoneElse, b!, c!], { filesThrough: [1] });
    feeds.ownFeed(GUEST_KEY, CHAT_TOPIC, [a!, c!, d!]);

    const comparison = await compare(feeds);

    expect(ids(comparison.chat), 'newest first, nobody else').toEqual([idOf('c'), idOf('b'), idOf('a')]);
    expect(ids(comparison.own ?? [])).toEqual([idOf('d'), idOf('c'), idOf('a')]);
    expect(ids(comparison.missingFromOwnFeed)).toEqual([idOf('b')]);
    expect(ids(comparison.missingFromChat)).toEqual([idOf('d')]);
    expect(isInOwnFeed(comparison, c!.sig)).toBe(true);
    expect(isInOwnFeed(comparison, b!.sig)).toBe(false);
  });

  it('reads every history file back to the first, and each entry no file holds by its own index', async () => {
    const messages = Array.from({ length: 9 }, (_, at) => message(`m${at}`));
    const feeds = servedFeeds();
    feeds.chat(SERVER_KEY, CHAT_TOPIC, messages, { filesThrough: [2, 5] });
    feeds.ownFeed(GUEST_KEY, CHAT_TOPIC, messages);

    const comparison = await compare(feeds);

    expect(comparison.chat).toHaveLength(9);
    expect(comparison.missingFromOwnFeed).toEqual([]);
    expect(feeds.asked.filter((read) => read.startsWith('bytes'))).toHaveLength(2);
  });

  it('reads a chat with no history file entry by entry, and passes over a slot never written', async () => {
    const messages = Array.from({ length: 4 }, (_, at) => message(`n${at}`));
    const feeds = servedFeeds();
    feeds.chat(SERVER_KEY, CHAT_TOPIC, messages, { missingSlots: [1] });

    const comparison = await compare(feeds);

    expect(ids(comparison.chat)).toEqual([idOf('n3'), idOf('n2'), idOf('n0')]);
  });

  it('says a sender keeps no own feed, and lacks a copy of every message', async () => {
    const feeds = servedFeeds();
    feeds.chat(SERVER_KEY, CHAT_TOPIC, [message('a'), message('b')]);

    const comparison = await compare(feeds);

    expect(comparison.own).toBeNull();
    expect(ids(comparison.missingFromOwnFeed)).toEqual([idOf('b'), idOf('a')]);
    expect(comparison.missingFromChat).toEqual([]);
  });

  it('counts no copy that fails the check a chat message passes, or is for another chat, or is in a gap', async () => {
    const [a, b] = [message('a'), message('b')];
    const tampered = { ...b, text: 'changed after signing' };
    const otherChat = createChatMessage(GUEST_KEY, {
      topic: 'chat-another-stream',
      type: MessageType.TEXT,
      text: 'elsewhere',
      name: 'Ada',
      via: MessageVia.OWN_STAMP,
    }).message;
    const feeds = servedFeeds();
    feeds.chat(SERVER_KEY, CHAT_TOPIC, [a, b]);
    feeds.ownFeed(GUEST_KEY, CHAT_TOPIC, [a, tampered, otherChat, null, new TextEncoder().encode('not json'), a]);

    const comparison = await compare(feeds);

    expect(ids(comparison.own ?? []), 'one copy of a, however often it was written').toEqual([idOf('a')]);
    expect(ids(comparison.missingFromOwnFeed)).toEqual([idOf('b')]);
  });

  it.each(['the own feed', 'the chat feed'])(
    'throws when %s cannot be looked up, which says nothing about the copies',
    async (which) => {
      const unanswered: SwarmAnswer = { kind: 'unavailable', cause: { kind: 'timeout', timeoutMs: 1_000 } };
      const feeds = servedFeeds();
      const owner = feeds.ownFeed(GUEST_KEY, CHAT_TOPIC, [message('a')]);
      const chatOwner = feeds.chat(SERVER_KEY, CHAT_TOPIC, [message('a')]);
      const unreadable = which === 'the own feed' ? owner : chatOwner;
      for (const key of [...feeds.heads.keys()].filter((head) => head.startsWith(unreadable))) {
        feeds.heads.set(key, unanswered);
      }

      await expect(compare(feeds)).rejects.toBeInstanceOf(OwnFeedUnreadableError);
    },
  );

  it("refuses to read an own feed whose newest index is past the sender's messages in the chat and a margin", async () => {
    const [a, b] = [message('a'), message('b')];
    const feeds = servedFeeds();
    feeds.chat(SERVER_KEY, CHAT_TOPIC, [a, b]);
    feeds.ownFeedHeadAt(GUEST_KEY, CHAT_TOPIC, 2 + OWN_FEED_MARGIN);

    await expect(compare(feeds)).rejects.toBeInstanceOf(OwnFeedTooLargeError);
    expect(
      feeds.asked.filter((read) => read.startsWith('chunk')),
      'only the chat entry before its head',
    ).toHaveLength(1);
  });

  it('reads an own feed whose newest index is just inside the cap', async () => {
    const [a, b] = [message('a'), message('b')];
    const feeds = servedFeeds();
    feeds.chat(SERVER_KEY, CHAT_TOPIC, [a, b]);
    feeds.ownFeed(GUEST_KEY, CHAT_TOPIC, [a]);
    feeds.ownFeedHeadAt(GUEST_KEY, CHAT_TOPIC, 2 + OWN_FEED_MARGIN - 1);

    const comparison = await compare(feeds);

    expect(ids(comparison.own ?? [])).toEqual([idOf('a')]);
  });

  it('refuses an own feed past the flat ceiling however many messages the sender sent, and allocates nothing for it', async () => {
    const feeds = servedFeeds();
    feeds.chat(SERVER_KEY, CHAT_TOPIC, [message('a')]);
    feeds.ownFeedHeadAt(GUEST_KEY, CHAT_TOPIC, Number.MAX_SAFE_INTEGER);

    await expect(compare(feeds)).rejects.toBeInstanceOf(OwnFeedTooLargeError);
    expect(MAX_OWN_FEED_ENTRIES).toBe(1_000);
  });

  it.each([
    ['a history row', { filesThrough: [1] }, 1],
    ['an entry read by its own index', {}, 1],
    ['the newest entry', {}, 2],
  ] as const)('counts and lists no chat message that fails the check, held as %s', async (_where, layout, at) => {
    const messages = [message('a'), message('b'), message('c')];
    messages[at] = { ...messages[at]!, text: 'changed after signing' };
    const feeds = servedFeeds();
    feeds.chat(SERVER_KEY, CHAT_TOPIC, messages, layout);
    feeds.ownFeed(GUEST_KEY, CHAT_TOPIC, []);

    const comparison = await compare(feeds);

    const kept = ['a', 'b', 'c']
      .filter((_, index) => index !== at)
      .map(idOf)
      .reverse();
    expect(ids(comparison.chat)).toEqual(kept);
    expect(ids(comparison.missingFromOwnFeed)).toEqual(kept);
  });

  it('stops following history files at one whose prev is not older than itself', async () => {
    const messages = Array.from({ length: 5 }, (_, at) => message(`p${at}`));
    const feeds = servedFeeds();
    feeds.chat(SERVER_KEY, CHAT_TOPIC, messages, { filesThrough: [1, 3] });
    const [oldest, newest] = [...feeds.files.keys()] as [string, string];
    const looped = {
      ...JSON.parse(new TextDecoder().decode(feeds.files.get(oldest))),
      prev: { ref: newest, toSeq: 3 },
    };
    feeds.files.set(oldest, new TextEncoder().encode(JSON.stringify(looped)));

    const comparison = await compare(feeds);

    expect(comparison.chat).toHaveLength(5);
    expect(feeds.asked.filter((read) => read.startsWith('bytes'))).toHaveLength(2);
  });

  it('says the chat could not be counted when its history runs past the files it reads', async () => {
    const messages = Array.from({ length: MAX_HISTORY_FILES + 2 }, (_, at) => message(`h${at}`));
    const feeds = servedFeeds();
    feeds.chat(SERVER_KEY, CHAT_TOPIC, messages, { filesThrough: messages.map((_, at) => at) });

    await expect(compare(feeds)).rejects.toBeInstanceOf(OwnFeedUnreadableError);
    expect(feeds.asked.filter((read) => read.startsWith('bytes'))).toHaveLength(MAX_HISTORY_FILES);
  });
});
