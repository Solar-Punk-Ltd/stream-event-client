import { FeedIndex, Topic } from '@ethersphere/bee-js';
import {
  type ChatMessage,
  type HistoryLink,
  ownFeedTopic,
  parseFeedEntry,
  parseHistoryFile,
} from '@solarpunkltd/swarm-chat-js/message';

import { makeFeedIdentifier } from '@/shared/feedFollow';
import type { ReadOptions } from '@/swarm/provider';

import type { ChatReads } from '../chatParts';
import { readOwnersChunk } from '../ownersChunk';
import type { MessageVerifier } from '../verify/messageVerifier';

/** One message of the sender's, as the chat feed or their own feed holds it. */
export interface OwnFeedRecord {
  /** Where it is: the chat feed's index, or the own feed's. */
  readonly index: number;
  readonly message: ChatMessage;
}

export interface OwnFeedComparison {
  /** The sender's messages in the whole chat feed, newest first. */
  readonly chat: readonly OwnFeedRecord[];
  /** The copies in the sender's own feed, newest first, or null when they keep no own feed. */
  readonly own: readonly OwnFeedRecord[] | null;
  /** Their messages in the chat with no copy in their own feed, newest first. */
  readonly missingFromOwnFeed: readonly OwnFeedRecord[];
  /** Copies in their own feed of messages the chat does not hold, newest first. */
  readonly missingFromChat: readonly OwnFeedRecord[];
}

/** A feed's newest entry or one of its history files could not be read, which says nothing about the copies. */
export class OwnFeedUnreadableError extends Error {
  constructor(what: string) {
    super(`${what} could not be read`);
    this.name = 'OwnFeedUnreadableError';
  }
}

interface CompareOwnFeedOptions {
  /** The chat's reader, on the source the viewer picked for the chat history. */
  readonly reads: () => ChatReads;
  readonly verify: MessageVerifier;
  /** The chat server's feed owner, 40 hex digits. */
  readonly chatOwner: string;
  readonly chatTopic: string;
  /** The sender's chat address, 40 hex digits, which owns their own feed. */
  readonly sender: string;
  readonly timeoutMs: number;
}

/** How many slots are read at once, where a feed is read entry by entry. */
const SLOTS_AT_ONCE = 8;

const NOT_FOUND = 'not-found';
const decoder = new TextDecoder();

const bareHex = (hex: string) => hex.replace(/^0x/, '').toLowerCase();
const newestFirst = (a: OwnFeedRecord, b: OwnFeedRecord) => b.index - a.index;

/** The feed's newest index, or null for a feed with no entry. */
async function newestIndex(reads: ChatReads, owner: string, topic: Topic, window: ReadOptions, what: string) {
  const head = await reads.readFeedHead(owner, topic, window);
  if (head.kind === NOT_FOUND) {
    return null;
  }
  if (head.kind !== 'content' || head.feedIndex === null) {
    throw new OwnFeedUnreadableError(what);
  }
  return { index: head.feedIndex, payload: head.bytes };
}

/** Reads `indices` a few at a time, in order, with `read`. */
async function inBatches<T>(indices: readonly number[], read: (index: number) => Promise<T>): Promise<T[]> {
  const results: T[] = [];
  for (let at = 0; at < indices.length; at += SLOTS_AT_ONCE) {
    results.push(...(await Promise.all(indices.slice(at, at + SLOTS_AT_ONCE).map(read))));
  }
  return results;
}

/** The payload of an owner's feed entry at `index`, or null when it is not there or not the owner's. */
async function readEntry(reads: ChatReads, owner: string, topic: Topic, index: number, window: ReadOptions) {
  const read = await readOwnersChunk(
    reads,
    owner,
    makeFeedIdentifier(topic, FeedIndex.fromBigInt(BigInt(index))),
    window,
  );
  return read.kind === 'chunk' ? read.chunk.payload : null;
}

/**
 * Every message of the chat feed, by its index: the newest entry, every history file back to the first, and each entry
 * no history file holds, read by its own index. An entry or a row that fails the library's check is left out.
 */
async function readWholeChat(options: CompareOwnFeedOptions, window: ReadOptions): Promise<Map<number, ChatMessage>> {
  const { chatTopic } = options;
  const reads = options.reads();
  const owner = bareHex(options.chatOwner);
  const topic = Topic.fromString(chatTopic);
  const messages = new Map<number, ChatMessage>();
  const head = await newestIndex(reads, owner, topic, window, 'the chat feed');
  if (head === null) {
    return messages;
  }

  const held = new Set<number>([head.index]);
  const entry = parseFeedEntry(head.payload, head.index, chatTopic);
  let link: HistoryLink | null = null;
  if (entry.ok) {
    messages.set(head.index, entry.value.msg);
    link = entry.value.history;
  }
  while (link !== null) {
    const answer = await reads.readBytes(link.ref, window);
    if (answer.kind !== 'content') {
      throw new OwnFeedUnreadableError('a history file of the chat');
    }
    const file = parseHistoryFile(answer.bytes, chatTopic, link);
    if (!file.ok) {
      break;
    }
    for (let seq = file.value.fromSeq; seq <= file.value.toSeq; seq++) {
      held.add(seq);
    }
    for (const row of file.value.rows) {
      messages.set(row.seq, row.msg);
    }
    link = file.value.prev;
  }

  const unheld = Array.from({ length: head.index }, (_, index) => index).filter((index) => !held.has(index));
  const payloads = await inBatches(unheld, (index) => readEntry(reads, owner, topic, index, window));
  unheld.forEach((index, at) => {
    const payload = payloads[at];
    const read = payload ? parseFeedEntry(payload, index, chatTopic) : null;
    if (read?.ok) {
      messages.set(index, read.value.msg);
    }
  });
  return messages;
}

/**
 * The copies in the sender's own feed, by index, each checked as a chat message is, the sender's, and for this chat,
 * or left out. Null when the sender keeps no own feed.
 */
async function readOwnFeed(options: CompareOwnFeedOptions, window: ReadOptions): Promise<OwnFeedRecord[] | null> {
  const { chatTopic, verify } = options;
  const reads = options.reads();
  const sender = bareHex(options.sender);
  const topic = Topic.fromString(ownFeedTopic(chatTopic));
  const head = await newestIndex(reads, sender, topic, window, "the sender's own feed");
  if (head === null) {
    return null;
  }
  const indices = Array.from({ length: head.index + 1 }, (_, index) => index);
  const copies = await inBatches(indices, async (index): Promise<OwnFeedRecord | null> => {
    const payload = await readEntry(reads, sender, topic, index, window);
    if (!payload) {
      return null;
    }
    let signed: unknown;
    try {
      signed = JSON.parse(decoder.decode(payload));
    } catch {
      return null;
    }
    const verdict = await verify.verify(signed);
    if (!verdict.ok || verdict.message.addr !== sender || verdict.message.topic !== chatTopic) {
      return null;
    }
    return { index, message: verdict.message };
  });
  return copies.filter((copy): copy is OwnFeedRecord => copy !== null);
}

/** The first record of each signature, so a message copied twice counts once. */
function onePerSignature(records: readonly OwnFeedRecord[]): OwnFeedRecord[] {
  const seen = new Set<string>();
  return records.filter(({ message }) => !seen.has(message.sig) && Boolean(seen.add(message.sig)));
}

/**
 * The sender's messages in the whole chat against the copies in their own feed. Both are read through the chat's
 * reader, the whole chat history and the whole own feed. A copy and a message are the same when their signatures are:
 * a message has one valid signature, over every field it says, and a copy is counted only once it passes the check a
 * chat message passes, so a matching signature means the very message the chat holds, which an id, chosen by the
 * sender, does not.
 *
 * @throws OwnFeedUnreadableError when a feed's newest entry or a history file of the chat could not be read.
 */
export async function compareOwnFeed(options: CompareOwnFeedOptions): Promise<OwnFeedComparison> {
  const window = { timeoutMs: options.timeoutMs };
  const sender = bareHex(options.sender);
  const [wholeChat, ownFeed] = await Promise.all([readWholeChat(options, window), readOwnFeed(options, window)]);

  const chat = onePerSignature(
    [...wholeChat]
      .filter(([, message]) => message.addr === sender)
      .map(([index, message]) => ({ index, message }))
      .sort(newestFirst),
  );
  const own = ownFeed === null ? null : onePerSignature([...ownFeed].sort(newestFirst));
  const inChat = new Set(chat.map(({ message }) => message.sig));
  const copied = new Set((own ?? []).map(({ message }) => message.sig));
  return {
    chat,
    own,
    missingFromOwnFeed: chat.filter(({ message }) => !copied.has(message.sig)),
    missingFromChat: (own ?? []).filter(({ message }) => !inChat.has(message.sig)),
  };
}

/** Whether the message signed `sig` has its copy in the sender's own feed. */
export function isInOwnFeed(comparison: OwnFeedComparison, sig: string): boolean {
  return (comparison.own ?? []).some(({ message }) => message.sig === sig);
}
