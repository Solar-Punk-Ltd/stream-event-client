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
import type { SwarmAnswer } from '@/swarm/answers';
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
  /** The sender's messages in the whole chat feed whose signature is valid, newest first, whoever paid for them. */
  readonly inChat: readonly OwnFeedRecord[];
  /** Messages in the chat feed that name the sender but whose signature does not match them, newest first. */
  readonly badSignatures: readonly OwnFeedRecord[];
  /**
   * The sender's messages in the whole chat feed that they paid for with their own stamp, by the `via` they signed,
   * newest first.
   */
  readonly chatOnOwnStamp: readonly OwnFeedRecord[];
  /** The sender's messages the gateway paid for, newest first. Such a message gets no copy, so it is never missing. */
  readonly byGateway: readonly OwnFeedRecord[];
  /** The copies in the sender's own feed, newest first, or null when they keep no own feed. */
  readonly own: readonly OwnFeedRecord[] | null;
  /** Their messages on their own stamp in the chat with no copy in their own feed, newest first. */
  readonly missingFromOwnFeed: readonly OwnFeedRecord[];
  /** Copies in their own feed of messages the chat does not hold, newest first. */
  readonly missingFromChat: readonly OwnFeedRecord[];
}

/** A feed's newest entry, one of its entries or a history file could not be read, which says nothing about the copies. */
export class OwnFeedUnreadableError extends Error {
  constructor(
    what: string,
    /** The source's answer, where a feed's newest entry could not be read. */
    readonly answer: SwarmAnswer | null = null,
  ) {
    super(`${what} could not be read`);
    this.name = 'OwnFeedUnreadableError';
  }
}

/**
 * The source answered the chat feed but turned away the sender's own feed. A gateway that serves only the chat
 * server's feeds answers anyone else's with a refusal, which a browser sees as a network failure when the refusal
 * carries no CORS headers. It says nothing about what the own feed holds.
 */
export class OwnFeedRefusedError extends Error {
  constructor() {
    super("the source does not serve the sender's own feed");
    this.name = 'OwnFeedRefusedError';
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

/**
 * Told how many feed entries a check will look at, each time a feed's newest index becomes known, and how many more it
 * has looked at, so a viewer can watch a check that takes many reads.
 */
export interface CheckProgress {
  readonly planned: (entries: number) => void;
  readonly checked: (entries: number) => void;
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
  readonly progress?: CheckProgress;
}

/** The messages of the whole chat by their feed index: those that pass the page's check, and those whose signature fails it. */
interface WholeChat {
  readonly checked: ReadonlyMap<number, ChatMessage>;
  readonly badSignatures: ReadonlyMap<number, ChatMessage>;
}

interface CompareOwnFeedOptions extends ChatWalkOptions {
  /** The sender's chat address, 40 hex digits, which owns their own feed. */
  readonly sender: string;
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
    throw new OwnFeedUnreadableError(what, head);
  }
  return { index: head.feedIndex, payload: head.bytes };
}

const REFUSED = 'refused';
/** A network failure is how a refusal without CORS headers reads, and also how a dropped connection reads. */
const MAYBE_REFUSED = 'maybe-refused';

/** Whether a failed feed head read is the source turning the read away, may be, or is not. */
function refusalOf(error: unknown): typeof REFUSED | typeof MAYBE_REFUSED | null {
  const answer = error instanceof OwnFeedUnreadableError ? error.answer : null;
  if (answer?.kind === 'unsupported') {
    return REFUSED;
  }
  if (answer?.kind !== 'unavailable') {
    return null;
  }
  const { cause } = answer;
  if (cause.kind === 'network') {
    return MAYBE_REFUSED;
  }
  return cause.kind === 'status' && cause.status >= 400 && cause.status < 500 ? REFUSED : null;
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
async function readWholeChat(options: ChatWalkOptions): Promise<WholeChat> {
  const { chatTopic } = options;
  const window = windowOf(options);
  const reads = options.reads();
  const owner = bareHex(options.chatOwner);
  const topic = Topic.fromString(chatTopic);
  const messages = new Map<number, ChatMessage>();
  const head = await newestIndex(reads, owner, topic, window, 'the chat feed');
  if (head === null) {
    return { checked: messages, badSignatures: new Map() };
  }
  const { progress } = options;
  progress?.planned(head.index + 1);
  progress?.checked(1);

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
    progress?.checked(file.value.toSeq - file.value.fromSeq + 1);
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
  const payloads = await inBatches(
    unheld,
    async (index) => {
      const payload = await readEntry(reads, owner, topic, index, window);
      progress?.checked(1);
      return payload;
    },
    options.signal,
  );
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
 * The messages that pass the check a chat message passes on this page, for this chat, each as the check read it, and
 * those that fail it, as the feed holds them. The chat server checked them before it published them, and a gateway
 * serving the chat could still change one.
 */
async function checkedMessages(
  messages: ReadonlyMap<number, ChatMessage>,
  { verify, chatTopic }: ChatWalkOptions,
): Promise<WholeChat> {
  const verdicts = await Promise.all(
    [...messages].map(async ([index, message]) => ({ index, message, verdict: await verify.verify(message) })),
  );
  const checked = new Map<number, ChatMessage>();
  const badSignatures = new Map<number, ChatMessage>();
  for (const { index, message, verdict } of verdicts) {
    if (!verdict.ok) {
      badSignatures.set(index, message);
    } else if (verdict.message.topic === chatTopic) {
      checked.set(index, verdict.message);
    }
  }
  return { checked, badSignatures };
}

/** The sender's own feed for this chat, its owner and its topic, both as bare hex, as a feed read names them. */
export function ownFeedAddress(sender: string, chatTopic: string): { readonly owner: string; readonly topic: string } {
  return { owner: bareHex(sender), topic: Topic.fromString(ownFeedTopic(chatTopic)).toHex() };
}

/** The own feed's newest entry, or null when the sender keeps no own feed. */
function ownFeedHead(options: CompareOwnFeedOptions) {
  const topic = Topic.fromString(ownFeedTopic(options.chatTopic));
  return newestIndex(options.reads(), bareHex(options.sender), topic, windowOf(options), "the sender's own feed");
}

/**
 * The own feed's newest entry, read a second time after a network failure, which is called a refusal only when the
 * second read fails the same way, so one dropped connection is not.
 *
 * @throws OwnFeedRefusedError when the source turned the read away.
 */
async function judgedOwnFeedHead(options: CompareOwnFeedOptions) {
  try {
    return await ownFeedHead(options);
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal === REFUSED) {
      throw new OwnFeedRefusedError();
    }
    if (refusal !== MAYBE_REFUSED) {
      throw error;
    }
  }
  try {
    return await ownFeedHead(options);
  } catch (error) {
    throw refusalOf(error) === null ? error : new OwnFeedRefusedError();
  }
}

/**
 * The copies in the sender's own feed, each checked as a chat message is, the sender's, and for this chat, or left
 * out, or null when the feed has no entry. Indices 0 to `newest` are read, then each index after it until one is not
 * there, since a gateway may serve a head seconds old and a copy written since then would otherwise count as missing.
 *
 * @throws OwnFeedTooLargeError when an entry is found at or past `cap`.
 */
async function readOwnFeed(
  options: CompareOwnFeedOptions,
  newest: number | null,
  cap: number,
): Promise<OwnFeedRecord[] | null> {
  const window = windowOf(options);
  const { chatTopic, verify, progress } = options;
  const reads = options.reads();
  const sender = bareHex(options.sender);
  const topic = Topic.fromString(ownFeedTopic(chatTopic));
  const readCounted = async (index: number) => {
    const payload = await readEntry(reads, sender, topic, index, window);
    progress?.checked(1);
    return payload;
  };
  const known = newest === null ? 0 : newest + 1;
  progress?.planned(known);
  const payloads = await inBatches(
    Array.from({ length: known }, (_, index) => index),
    readCounted,
    options.signal,
  );
  for (let index = known; ; index++) {
    options.signal?.throwIfAborted();
    progress?.planned(1);
    const payload = await readCounted(index);
    if (payload === null) {
      break;
    }
    if (index >= cap) {
      throw new OwnFeedTooLargeError(index, cap);
    }
    payloads.push(payload);
  }
  if (payloads.length === 0) {
    return null;
  }
  const copies = await Promise.all(
    payloads.map(async (payload, index): Promise<OwnFeedRecord | null> => {
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
    }),
  );
  return copies.filter((copy): copy is OwnFeedRecord => copy !== null);
}

/** The first record of each signature, so a message copied twice counts once. */
function onePerSignature(records: readonly OwnFeedRecord[]): OwnFeedRecord[] {
  const seen = new Set<string>();
  return records.filter(({ message }) => !seen.has(message.sig) && Boolean(seen.add(message.sig)));
}

/**
 * The sender's messages in the whole chat, split by who paid for each as its signed `via` says, against the copies in
 * their own feed. Both are read afresh through the chat's reader on every call, the whole chat history and the own
 * feed up to {@link ownFeedCap}, since a chat read earlier than the own feed would lack messages the own feed already
 * holds and show them as missing from the chat. A copy and a message
 * are the same when their signatures are: a message has one valid signature, over every field it says, and both sides
 * are counted only once they pass the check a chat message passes, so a matching signature means the copy is the
 * message the chat feed shows, which an id, chosen by the sender, would not. That the chat feed shows what the chat
 * server published holds only as far as the server, which writes the feed, is trusted.
 *
 * @throws OwnFeedUnreadableError when a feed's newest entry, one of its entries or a history file of the chat could not
 *   be read.
 * @throws OwnFeedRefusedError when the source served the chat but turned away the own feed's newest entry.
 * @throws OwnFeedTooLargeError when the own feed names more entries than {@link ownFeedCap} allows.
 */
export async function compareOwnFeed(options: CompareOwnFeedOptions): Promise<OwnFeedComparison> {
  const sender = bareHex(options.sender);
  const ownHeadRead = judgedOwnFeedHead(options);
  // A chat walk that fails is the answer, and the own feed head's own failure is then never read.
  ownHeadRead.catch(() => {});
  const wholeChat = await readWholeChat(options);
  const ownHead = await ownHeadRead;
  const sent = sendersRecords(wholeChat.checked, sender);
  const cap = ownFeedCap(sent.length);
  if (ownHead !== null && ownHead.index >= cap) {
    throw new OwnFeedTooLargeError(ownHead.index, cap);
  }
  const ownFeed = await readOwnFeed(options, ownHead?.index ?? null, cap);

  const inChat = onePerSignature(sent);
  const chatOnOwnStamp = inChat.filter(({ message }) => message.via === MessageVia.OWN_STAMP);
  const own = ownFeed === null ? null : onePerSignature([...ownFeed].sort(newestFirst));
  const signedInChat = new Set(sent.map(({ message }) => message.sig));
  const copied = new Set((own ?? []).map(({ message }) => message.sig));
  return {
    inChat,
    badSignatures: sendersRecords(wholeChat.badSignatures, sender),
    chatOnOwnStamp,
    byGateway: inChat.filter(({ message }) => message.via !== MessageVia.OWN_STAMP),
    own,
    missingFromOwnFeed: chatOnOwnStamp.filter(({ message }) => !copied.has(message.sig)),
    missingFromChat: (own ?? []).filter(({ message }) => !signedInChat.has(message.sig)),
  };
}

/** The messages that name `sender` as their address, newest first. */
function sendersRecords(messages: ReadonlyMap<number, ChatMessage>, sender: string): OwnFeedRecord[] {
  return [...messages]
    .filter(([, message]) => message.addr === sender)
    .map(([index, message]) => ({ index, message }))
    .sort(newestFirst);
}

/** Whether the message signed `sig` has its copy in the sender's own feed. */
export function isInOwnFeed(comparison: OwnFeedComparison, sig: string): boolean {
  return (comparison.own ?? []).some(({ message }) => message.sig === sig);
}
