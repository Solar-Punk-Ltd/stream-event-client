import { Bee, Topic } from '@ethersphere/bee-js';
import { parseFeedEntry, verifyChatMessage } from '@solarpunkltd/swarm-chat-js';

import { healthStatus, waitFor } from './bee.ts';
import type { FeedEntry } from './chatFeed.ts';
import type { LocalStack } from './deployment.ts';
import { followFeed } from './liveFeed.ts';
import { CHAT_TIMEOUT_MS, type Run } from './run.ts';

/**
 * How long a live read waits before asking the feed's next unwritten slot again. Six asks a minute stays well under the
 * 25 to 40 early asks that delayed a chat message, so the kit's read never slows the chat it checks.
 */
const LIVE_ASK_INTERVAL_MS = 10_000;

/** How many messages the feed must hold, and which texts must be among them, before the read returns. */
interface FeedWait {
  /** The feed must have confirmed at least this many entries. Defaults to what the run sent. */
  atLeast?: number;
  /** Every one of these texts must be present and verified, which is how a shared, growing feed is waited on safely. */
  texts?: string[];
}

function readEntry(payload: Uint8Array, index: number, run: Run): FeedEntry {
  const entry = parseFeedEntry(payload, index, run.deployment.chatTopic);
  if (!entry.ok) return { index, ok: false, reason: `${entry.reason}: ${entry.detail}` };
  const check = verifyChatMessage(entry.value.msg, {
    origin: run.addresses.viewer,
    allowLocalHttp: run.local !== null,
  });
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

async function readAll(run: Run, local: LocalStack, nextSeq: number): Promise<FeedEntry[]> {
  const reader = new Bee(local.addresses.queen).feed.makeReader(
    Topic.fromString(run.deployment.chatTopic),
    run.deployment.feedOwner,
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
  if (!run.local) return readLiveChatFeed(run, texts);
  const local = run.local;
  return waitFor(
    `the chat feed to hold ${atLeast} entries including ${texts.length} named messages`,
    async () => {
      const { body } = await healthStatus(local.addresses.chatServer);
      const chat = (body as { chats?: { topic: string; nextSeq: number | null; inFlight: number }[] })?.chats?.find(
        (candidate) => candidate.topic === run.deployment.chatTopic,
      );
      if (!chat || chat.inFlight !== 0 || (chat.nextSeq ?? 0) < atLeast) return null;
      const entries = await readAll(run, local, chat.nextSeq ?? 0);
      const found = new Set(entries.filter((entry) => entry.ok).map((entry) => (entry as { text: string }).text));
      return texts.every((text) => found.has(text)) ? entries : null;
    },
    { timeoutMs: CHAT_TIMEOUT_MS },
  );
}

/** The status Bee answers for a feed slot that is not written. */
const NOT_WRITTEN = 404;

/**
 * Reads the chat feed of a real deployment through the chat's read address, as the viewer reads it, since the chat
 * server's `/health` answers only on the deployment's own machine, through a tunnel at most. The wait is on the feed alone, so it
 * is bounded and its verdict says so: every text must be among the verified entries within the chat's timeout.
 */
async function readLiveChatFeed(run: Run, texts: string[]): Promise<FeedEntry[]> {
  const live = run.live!;
  const reader = new Bee(live.chatRead).feed.makeReader(
    Topic.fromString(run.deployment.chatTopic),
    run.deployment.feedOwner,
  );
  const slot = async (index: number) => {
    try {
      return (await reader.downloadPayload({ index })).payload.toUint8Array();
    } catch (error) {
      if ((error as { status?: number }).status === NOT_WRITTEN) return null;
      throw error;
    }
  };
  const { entries, unwrittenAsks, waitedMs } = await followFeed(
    slot,
    (payload, index) => readEntry(payload, index, run),
    texts,
    { timeoutMs: CHAT_TIMEOUT_MS, intervalMs: LIVE_ASK_INTERVAL_MS },
  );
  const recorded = (run.findings['live chat feed reads'] as unknown[] | undefined) ?? [];
  run.findings['live chat feed reads'] = [
    ...recorded,
    {
      source: live.chatRead,
      entries: entries.length,
      unwrittenAsks,
      waitedMs,
      counts: live.chatHealth
        ? `the steps that need them read them through ${live.chatHealth}`
        : "not read, the chat server's /health answers only on the deployment's own machine",
    },
  ];
  return entries;
}
