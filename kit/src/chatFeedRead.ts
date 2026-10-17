import { Bee, Topic } from '@ethersphere/bee-js';
import { parseFeedEntry, verifyChatMessage } from '@solarpunkltd/swarm-chat-js';

import { healthStatus, waitFor } from './bee.ts';
import type { FeedEntry } from './chatFeed.ts';
import { CHAT_TIMEOUT_MS, type Run } from './run.ts';

/** How many messages the feed must hold, and which texts must be among them, before the read returns. */
interface FeedWait {
  /** The feed must have confirmed at least this many entries. Defaults to what the run sent. */
  atLeast?: number;
  /** Every one of these texts must be present and verified, which is how a shared, growing feed is waited on safely. */
  texts?: string[];
}

function readEntry(payload: Uint8Array, index: number, run: Run): FeedEntry {
  const entry = parseFeedEntry(payload, index, run.state.chatTopic);
  if (!entry.ok) return { index, ok: false, reason: `${entry.reason}: ${entry.detail}` };
  const check = verifyChatMessage(entry.value.msg, { origin: run.addresses.viewer, allowLocalHttp: true });
  return check.ok
    ? {
        index,
        ok: true,
        text: check.message.text,
        via: check.message.via,
        account: check.identity?.account ?? null,
        wallet: check.identity?.wallet ?? null,
        addr: check.message.addr,
      }
    : { index, ok: false, reason: `${check.reason}: ${check.detail}`, text: entry.value.msg.text };
}

async function readAll(run: Run, nextSeq: number): Promise<FeedEntry[]> {
  const reader = new Bee(run.addresses.queen).feed.makeReader(
    Topic.fromString(run.state.chatTopic),
    run.state.feedOwner,
  );
  const entries: FeedEntry[] = [];
  for (let index = 0; index < nextSeq; index++) {
    const { payload } = await reader.downloadPayload({ index });
    entries.push(readEntry(payload.toUint8Array(), index, run));
  }
  return entries;
}

/**
 * Reads every entry the chat server confirmed in the chat's feed, from Bee, and checks each as a reader does. The feed
 * is shared and grows across a whole `kit test`, so a count alone says nothing about this scenario's messages: the read
 * waits until the feed holds at least `atLeast` entries and every text in `texts` is present and verified, then returns
 * the whole feed. Asks only for slots the server says are written, since a read of a slot not yet written makes Bee skip
 * its peers for that address for a minute.
 */
export async function readChatFeed(run: Run, wait: FeedWait | number = {}): Promise<FeedEntry[]> {
  const { atLeast = run.sent.length, texts = run.sent.map((message) => message.text) } =
    typeof wait === 'number' ? { atLeast: wait, texts: [] } : wait;
  return waitFor(
    `the chat feed to hold ${atLeast} entries including ${texts.length} named messages`,
    async () => {
      const { body } = await healthStatus(run.addresses.chatServer);
      const chat = (body as { chats?: { topic: string; nextSeq: number | null; inFlight: number }[] })?.chats?.find(
        (candidate) => candidate.topic === run.state.chatTopic,
      );
      if (!chat || chat.inFlight !== 0 || (chat.nextSeq ?? 0) < atLeast) return null;
      const entries = await readAll(run, chat.nextSeq ?? 0);
      const found = new Set(entries.filter((entry) => entry.ok).map((entry) => (entry as { text: string }).text));
      return texts.every((text) => found.has(text)) ? entries : null;
    },
    { timeoutMs: CHAT_TIMEOUT_MS },
  );
}
