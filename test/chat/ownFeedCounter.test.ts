import { type ChatMessage, createChatMessage, MessageType, MessageVia } from '@solarpunkltd/swarm-chat-js';
import { describe, expect, it } from 'vitest';

import type { ChatReads } from '../../src/features/chat/chatParts';
import { COUNT_KEPT_MS, createOwnFeedCounter, MAX_KEPT_COUNTS } from '../../src/features/chat/stamp/ownFeedCounter';
import { servedFeeds } from '../helpers/chatFeed';
import { addressOf, GUEST_KEY, idOf, inThreadVerifier, SECOND_GUEST_KEY } from '../helpers/signedChat';

const CHAT_TOPIC = 'chat-stream-one';
const SERVER_KEY = 'c3'.repeat(32);

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

/** A chat of two senders' messages, a counter over it on a clock the test moves, and how often the chat head was read. */
function counting(reads?: (feeds: ReturnType<typeof servedFeeds>) => ChatReads) {
  const feeds = servedFeeds();
  const chatOwner = feeds.chat(SERVER_KEY, CHAT_TOPIC, [message('a'), message('b', SECOND_GUEST_KEY)]);
  feeds.ownFeed(GUEST_KEY, CHAT_TOPIC, [message('a')]);
  const clock = { now: 0 };
  const counter = createOwnFeedCounter(
    { reads: () => reads?.(feeds) ?? feeds.reads, chatTopic: CHAT_TOPIC, chatOwner },
    { verify: inThreadVerifier(), timeoutMs: 1_000, now: () => clock.now },
  );
  const chatHeadReads = () => feeds.asked.filter((read) => read.startsWith(`head ${chatOwner}`)).length;
  return { feeds, clock, counter, chatHeadReads };
}

const never = new AbortController().signal;

describe("counting senders' own feeds in one chat", () => {
  it('reads the chat once for every sender whose details are open', async () => {
    const { counter, chatHeadReads } = counting();

    const [first, second] = await Promise.all([
      counter.count(addressOf(GUEST_KEY), never),
      counter.count(addressOf(SECOND_GUEST_KEY), never),
    ]);

    expect(first.chatOnOwnStamp).toHaveLength(1);
    expect(second.chatOnOwnStamp).toHaveLength(1);
    expect(chatHeadReads()).toBe(1);
  });

  it('answers a sender counted a moment ago from what it found, and reads again once that is old', async () => {
    const { feeds, clock, counter } = counting();
    const sender = addressOf(GUEST_KEY);

    await counter.count(sender, never);
    const readsBefore = feeds.asked.length;
    await counter.count(sender, never);
    expect(feeds.asked.length).toBe(readsBefore);

    clock.now += COUNT_KEPT_MS + 1;
    await counter.count(sender, never);
    expect(feeds.asked.length).toBeGreaterThan(readsBefore);
  });

  it('reads the chat and the own feed again when the sender is forgotten, as a recount asks', async () => {
    const { counter, chatHeadReads } = counting();
    const sender = addressOf(GUEST_KEY);

    await counter.count(sender, never);
    counter.forget(sender);
    await counter.count(sender, never);

    expect(chatHeadReads()).toBe(2);
  });

  it('keeps at most a bounded number of counts, the oldest let go first', async () => {
    const { feeds, counter } = counting();
    const senders = Array.from({ length: MAX_KEPT_COUNTS + 1 }, (_, at) => (at + 1).toString(16).padStart(40, '0'));
    for (const sender of senders) {
      await counter.count(sender, never);
    }
    const readsBefore = feeds.asked.length;

    await counter.count(senders.at(-1)!, never);
    expect(feeds.asked.length, 'the newest is kept').toBe(readsBefore);
    await counter.count(senders[0]!, never);
    expect(feeds.asked.length, 'the oldest was let go').toBeGreaterThan(readsBefore);
  });

  it('aborts the shared chat walk only when every count waiting on it is aborted', async () => {
    const seen: AbortSignal[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { counter } = counting((feeds) => ({
      ...feeds.reads,
      readFeedHead: async (owner, topic, options) => {
        if (options?.signal) {
          seen.push(options.signal);
        }
        await held;
        return options?.signal?.aborted ? { kind: 'aborted' } : feeds.reads.readFeedHead(owner, topic);
      },
    }));
    const [first, second] = [new AbortController(), new AbortController()];

    const counts = [
      counter.count(addressOf(GUEST_KEY), first.signal),
      counter.count(addressOf(SECOND_GUEST_KEY), second.signal),
    ].map((count) => count.catch((error: unknown) => error));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [chatWalk] = seen;
    first.abort();
    expect(chatWalk?.aborted, 'still wanted by the second count').toBe(false);
    second.abort();
    expect(chatWalk?.aborted).toBe(true);
    release();
    await Promise.all(counts);
  });
});
