import { FeedIndex, Topic } from '@ethersphere/bee-js';
import {
  type ChatMessage,
  type HistoryLink,
  MessageVia,
  ownFeedTopic,
  parseFeedEntry,
  parseHistoryFile,
} from '@solarpunkltd/swarm-chat-js/message';

import { makeFeedIdentifier } from '@/shared/feedFollow';
import type { ReadOptions } from '@/swarm/provider';

import { type ChatReads, isAbsent } from '../chatParts';
import { readOwnersChunk } from '../ownersChunk';
import type { MessageVerifier } from '../verify/messageVerifier';

/** One message of the sender's, as the chat feed or their own feed holds it. */
export interface OwnFeedRecord {
  /** Where it is: the chat feed's index, or the own feed's. */
  readonly index: number;
  readonly message: ChatMessage;
}

export interface OwnFeedComparison {
  /**
   * The sender's messages in the whole chat feed that they paid for with their own stamp, newest first. A message the
   * gateway paid for gets no copy, so it is neither counted nor missing.
   */
  readonly chatOnOwnStamp: readonly OwnFeedRecord[];
  /** The copies in the sender's own feed, newest first, or null when they keep no own feed. */
  readonly own: readonly OwnFeedRecord[] | null;
  /** Their messages on their own stamp in the chat with no copy in their own feed, newest first. */
  readonly missingFromOwnFeed: readonly OwnFeedRecord[];
  /** Copies in their own feed of messages the chat does not hold, newest first. */
  readonly missingFromChat: readonly OwnFeedRecord[];
}

/** A feed's newest entry, one of its entries or a history file could not be read, which says nothing about the copies. */
export class OwnFeedUnreadableError extends Error {
  constructor(what: string) {
    super(`${what} could not be read`);
    this.name = 'OwnFeedUnreadableError';
  }
}

/**
 * The sender's own feed names more entries than their messages in the chat can account for. Its newest index is the
 * sender's to choose, so it is never read whole past {@link ownFeedCap}.
 */
export class OwnFeedTooLargeError extends Error {
  constructor(newest: number, cap: number) {
    super(`the own feed names ${newest + 1} entries, more than the ${cap} its messages in the chat allow`);
    this.name = 'OwnFeedTooLargeError';
  }
}

/**
 * How many entries past the sender's messages in the chat an own feed may hold. A copy is written for a message on the
 * sender's own stamp, the chat's or not yet in it, and a failed copy keeps its index, so an honest feed outgrows the
 * chat only by the messages that never reached it.
 */
export const OWN_FEED_MARGIN = 25;

/**
 * The most own feed entries read for one sender, whatever the chat holds. One chat history file holds up to 1,000
 * messages, and 1,000 entries are 125 rounds of {@link SLOTS_AT_ONCE} reads.
 */
export const MAX_OWN_FEED_ENTRIES = 1_000;

/** How many own feed entries are read for a sender with `sentInChat` messages in the chat. */
function ownFeedCap(sentInChat: number): number {
  return Math.min(sentInChat + OWN_FEED_MARGIN, MAX_OWN_FEED_ENTRIES);
}

/** Where the chat is read, and how each read is bounded. */
interface ChatWalkOptions {
  /** The chat's reader, on the source the viewer picked for the chat history. */
  readonly reads: () => ChatReads;
  readonly verify: MessageVerifier;
  /** The chat server's feed owner, 40 hex digits. */
  readonly chatOwner: string;
  readonly chatTopic: string;
  readonly timeoutMs: number;
  /** Ends every read the walk makes, and the walk with them. */
  readonly signal?: AbortSignal;
}

/** Every message of the chat that passed the page's check, by its feed index. */
export type WholeChat = ReadonlyMap<number, ChatMessage>;

interface CompareOwnFeedOptions extends ChatWalkOptions {
  /** The sender's chat address, 40 hex digits, which owns their own feed. */
  readonly sender: string;
  /** The chat as {@link readWholeChat} read it, for a caller that shares one walk between senders. Read here if absent. */
  readonly wholeChat?: Promise<WholeChat>;
}

const windowOf = ({ timeoutMs, signal }: ChatWalkOptions): ReadOptions => ({ timeoutMs, signal });

/** How many slots are read at once, where a feed is read entry by entry. */
const SLOTS_AT_ONCE = 8;

const decoder = new TextDecoder();

const bareHex = (hex: string) => hex.replace(/^0x/, '').toLowerCase();
const newestFirst = (a: OwnFeedRecord, b: OwnFeedRecord) => b.index - a.index;

/** The feed's newest index, or null for a feed with no entry. */
async function newestIndex(reads: ChatReads, owner: string, topic: Topic, window: ReadOptions, what: string) {
  const head = await reads.readFeedHead(owner, topic, window);
  if (isAbsent(head)) {
    return null;
  }
  if (head.kind !== 'content' || head.feedIndex === null) {
    throw new OwnFeedUnreadableError(what);
  }
  return { index: head.feedIndex, payload: head.bytes };
}

/** Reads `indices` a few at a time, in order, with `read`, and starts no batch once `signal` is aborted. */
async function inBatches<T>(
  indices: readonly number[],
  read: (index: number) => Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T[]> {
  const results: T[] = [];
  for (let at = 0; at < indices.length; at += SLOTS_AT_ONCE) {
    signal?.throwIfAborted();
    results.push(...(await Promise.all(indices.slice(at, at + SLOTS_AT_ONCE).map(read))));
  }
  return results;
}

/**
 * The payload of an owner's feed entry at `index`, or null when the source answers that it is not there, by the rule the
 * chat reads its slots with. Any other answer, and a chunk that is not the owner's, says nothing about whether the
 * entry is there.
 *
 * @throws OwnFeedUnreadableError when the entry could not be read.
 */
async function readEntry(
  reads: ChatReads,
  owner: string,
  topic: Topic,
  index: number,
  window: ReadOptions,
): Promise<Uint8Array | null> {
  const read = await readOwnersChunk(
    reads,
    owner,
    makeFeedIdentifier(topic, FeedIndex.fromBigInt(BigInt(index))),
    window,
  );
  if (read.kind === 'chunk') {
    return read.chunk.payload;
  }
  if (read.kind === 'answer' && isAbsent(read.answer)) {
    return null;
  }
  throw new OwnFeedUnreadableError(`the feed entry at index ${index}`);
}

/**
 * The most history files read for one chat. A file closes at 1,000 messages or 512 KB, so 50 files hold a chat of at
 * least about 8,000 messages, past which the chat is not counted.
 */
export const MAX_HISTORY_FILES = 50;

/** The feed indices `from` to `to`, both included, that one history file holds. */
interface SeqRange {
  readonly from: number;
  readonly to: number;
}

/**
 * The most chat entries read one by one, those no history file holds. The chat server warns past 500 entries published
 * since its last saved history file, so an honest chat stays under it.
 */
export const MAX_ENTRIES_READ_ALONE = 500;

/**
 * The indices from 0 to `end`, `end` left out, that no range in `held` covers, in order, or null when there are more
 * than `limit`. Counted before any is listed, since `end` is the feed's newest index as the source reports it.
 */
function indicesOutside(held: readonly SeqRange[], end: number, limit: number): number[] | null {
  const ranges = [...held].sort((a, b) => a.from - b.from);
  const gaps: SeqRange[] = [];
  let next = 0;
  for (const { from, to } of ranges) {
    if (Math.min(from, end) > next) {
      gaps.push({ from: next, to: Math.min(from, end) - 1 });
    }
    next = Math.max(next, to + 1);
  }
  if (end > next) {
    gaps.push({ from: next, to: end - 1 });
  }
  const count = gaps.reduce((sum, { from, to }) => sum + to - from + 1, 0);
  if (count > limit) {
    return null;
  }
  return gaps.flatMap(({ from, to }) => Array.from({ length: to - from + 1 }, (_, at) => from + at));
}

/**
 * Every message of the chat feed, by its index: the newest entry, every history file back to the first, and each entry
 * no history file holds, read by its own index. An entry or a row that fails the library's check, or the check a
 * message passes on this page, is left out.
 */
export async function readWholeChat(options: ChatWalkOptions): Promise<WholeChat> {
  const { chatTopic } = options;
  const window = windowOf(options);
  const reads = options.reads();
  const owner = bareHex(options.chatOwner);
  const topic = Topic.fromString(chatTopic);
  const messages = new Map<number, ChatMessage>();
  const head = await newestIndex(reads, owner, topic, window, 'the chat feed');
  if (head === null) {
    return messages;
  }

  const held: SeqRange[] = [];
  const entry = parseFeedEntry(head.payload, head.index, chatTopic);
  let link: HistoryLink | null = null;
  if (entry.ok) {
    messages.set(head.index, entry.value.msg);
    link = entry.value.history;
  }
  for (let filesRead = 0; link !== null; filesRead++) {
    if (filesRead === MAX_HISTORY_FILES) {
      throw new OwnFeedUnreadableError(`the chat's history past ${MAX_HISTORY_FILES} files`);
    }
    const answer = await reads.readBytes(link.ref, window);
    if (answer.kind !== 'content') {
      throw new OwnFeedUnreadableError('a history file of the chat');
    }
    const file = parseHistoryFile(answer.bytes, chatTopic, link);
    if (!file.ok) {
      break;
    }
    held.push({ from: file.value.fromSeq, to: file.value.toSeq });
    for (const row of file.value.rows) {
      messages.set(row.seq, row.msg);
    }
    const { prev } = file.value;
    // Each file links to an older one, so a link that does not go back would be followed for ever.
    link = prev !== null && prev.toSeq < file.value.fromSeq ? prev : null;
  }

  const unheld = indicesOutside(held, head.index, MAX_ENTRIES_READ_ALONE);
  if (unheld === null) {
    throw new OwnFeedUnreadableError(`the chat's entries past ${MAX_ENTRIES_READ_ALONE} outside its history files`);
  }
  const payloads = await inBatches(unheld, (index) => readEntry(reads, owner, topic, index, window), options.signal);
  unheld.forEach((index, at) => {
    const payload = payloads[at];
    const read = payload ? parseFeedEntry(payload, index, chatTopic) : null;
    if (read?.ok) {
      messages.set(index, read.value.msg);
    }
  });
  return checkedMessages(messages, options);
}

/**
 * The messages that pass the check a chat message passes on this page, for this chat, each as the check read it. The
 * chat server checked them before it published them, and a gateway serving the chat could still change one.
 */
async function checkedMessages(
  messages: ReadonlyMap<number, ChatMessage>,
  { verify, chatTopic }: ChatWalkOptions,
): Promise<Map<number, ChatMessage>> {
  const verdicts = await Promise.all(
    [...messages].map(async ([index, message]) => ({ index, verdict: await verify.verify(message) })),
  );
  const checked = new Map<number, ChatMessage>();
  for (const { index, verdict } of verdicts) {
    if (verdict.ok && verdict.message.topic === chatTopic) {
      checked.set(index, verdict.message);
    }
  }
  return checked;
}

/** The own feed's newest entry, or null when the sender keeps no own feed. */
function ownFeedHead(options: CompareOwnFeedOptions) {
  const topic = Topic.fromString(ownFeedTopic(options.chatTopic));
  return newestIndex(options.reads(), bareHex(options.sender), topic, windowOf(options), "the sender's own feed");
}

/**
 * The copies in the sender's own feed at indices 0 to `newest`, each checked as a chat message is, the sender's, and
 * for this chat, or left out.
 */
async function readOwnFeed(options: CompareOwnFeedOptions, newest: number): Promise<OwnFeedRecord[]> {
  const window = windowOf(options);
  const { chatTopic, verify } = options;
  const reads = options.reads();
  const sender = bareHex(options.sender);
  const topic = Topic.fromString(ownFeedTopic(chatTopic));
  const indices = Array.from({ length: newest + 1 }, (_, index) => index);
  const copies = await inBatches(
    indices,
    async (index): Promise<OwnFeedRecord | null> => {
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
    },
    options.signal,
  );
  return copies.filter((copy): copy is OwnFeedRecord => copy !== null);
}

/** The first record of each signature, so a message copied twice counts once. */
function onePerSignature(records: readonly OwnFeedRecord[]): OwnFeedRecord[] {
  const seen = new Set<string>();
  return records.filter(({ message }) => !seen.has(message.sig) && Boolean(seen.add(message.sig)));
}

/**
 * The sender's messages on their own stamp in the whole chat against the copies in their own feed. Both are read
 * through the chat's reader, the whole chat history and the own feed up to {@link ownFeedCap}. A copy and a message
 * are the same when their signatures are: a message has one valid signature, over every field it says, and both sides
 * are counted only once they pass the check a chat message passes, so a matching signature means the copy is the
 * message the chat feed shows, which an id, chosen by the sender, would not. That the chat feed shows what the chat
 * server published holds only as far as the server, which writes the feed, is trusted.
 *
 * @throws OwnFeedUnreadableError when a feed's newest entry, one of its entries or a history file of the chat could not
 *   be read.
 * @throws OwnFeedTooLargeError when the own feed names more entries than {@link ownFeedCap} allows.
 */
export async function compareOwnFeed(options: CompareOwnFeedOptions): Promise<OwnFeedComparison> {
  const sender = bareHex(options.sender);
  const [wholeChat, ownHead] = await Promise.all([options.wholeChat ?? readWholeChat(options), ownFeedHead(options)]);
  const sentInChat = [...wholeChat.values()].filter((message) => message.addr === sender).length;
  const cap = ownFeedCap(sentInChat);
  if (ownHead !== null && ownHead.index >= cap) {
    throw new OwnFeedTooLargeError(ownHead.index, cap);
  }
  const ownFeed = ownHead === null ? null : await readOwnFeed(options, ownHead.index);

  const sent = [...wholeChat]
    .filter(([, message]) => message.addr === sender)
    .map(([index, message]) => ({ index, message }))
    .sort(newestFirst);
  const chatOnOwnStamp = onePerSignature(sent.filter(({ message }) => message.via === MessageVia.OWN_STAMP));
  const own = ownFeed === null ? null : onePerSignature([...ownFeed].sort(newestFirst));
  const inChat = new Set(sent.map(({ message }) => message.sig));
  const copied = new Set((own ?? []).map(({ message }) => message.sig));
  return {
    chatOnOwnStamp,
    own,
    missingFromOwnFeed: chatOnOwnStamp.filter(({ message }) => !copied.has(message.sig)),
    missingFromChat: (own ?? []).filter(({ message }) => !inChat.has(message.sig)),
  };
}

/** Whether the message signed `sig` has its copy in the sender's own feed. */
export function isInOwnFeed(comparison: OwnFeedComparison, sig: string): boolean {
  return (comparison.own ?? []).some(({ message }) => message.sig === sig);
}
