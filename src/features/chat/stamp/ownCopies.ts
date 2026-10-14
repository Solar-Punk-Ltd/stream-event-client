import { FeedIndex, Topic } from '@ethersphere/bee-js';
import { type ChatIdentity, type ChatMessage, ownFeedTopic } from '@solarpunkltd/swarm-chat-js/message';

import { makeFeedIdentifier } from '@/shared/feedFollow';
import type { ChatReads } from '../chatParts';
import { readOwnersChunk } from '../ownersChunk';
import type { MessageVerifier } from '../verify/messageVerifier';

/** One copy a sender kept in their own feed, checked as every chat message is. */
export interface OwnCopy {
  readonly index: number;
  readonly message: ChatMessage;
  readonly identity: ChatIdentity | null;
}

interface OwnCopiesPage {
  /** Newest first. */
  readonly copies: readonly OwnCopy[];
  /** Where the next, older page starts, or null when the feed has nothing older. */
  readonly nextIndex: number | null;
  /** Slots read and not shown: missing, not the sender's chunk, or a message that failed its check. */
  readonly hidden: number;
}

/** The feed's newest entry could not be read, which says nothing about whether the sender keeps one. */
export class OwnCopiesUnreadableError extends Error {
  constructor() {
    super("the sender's own feed could not be read");
    this.name = 'OwnCopiesUnreadableError';
  }
}

interface ReadOwnCopiesOptions {
  /** The chat's reader, on the source the viewer picked for the chat history. */
  readonly reads: () => Pick<ChatReads, 'readFeedHead' | 'readChunk' | 'readUnsignedSoc'>;
  readonly verify: MessageVerifier;
  /** The sender's chat address, 40 hex digits, which owns their own feed. */
  readonly owner: string;
  readonly chatTopic: string;
  /** The newest index to read, or null to start at the feed's newest entry. */
  readonly from: number | null;
  readonly count: number;
  readonly timeoutMs: number;
}

const decoder = new TextDecoder();

/**
 * A page of the copies a sender keeps in their own feed, `ownFeedTopic(chatTopic)` under their chat address. Only the
 * feed's newest index is taken from the head lookup. Every entry must be the sender's own single-owner chunk, read as
 * {@link readOwnersChunk} reads one, and every message in it passes the same check as a chat message, is the sender's, and is for
 * this chat, or it is not shown. Reads only.
 *
 * @throws OwnCopiesUnreadableError when the feed's newest entry could not be looked up.
 */
export async function readOwnCopies(options: ReadOwnCopiesOptions): Promise<OwnCopiesPage> {
  const { reads, verify, chatTopic, count, timeoutMs } = options;
  const owner = options.owner.replace(/^0x/, '').toLowerCase();
  const topic = Topic.fromString(ownFeedTopic(chatTopic));
  const window = { timeoutMs };

  let newest = options.from;
  if (newest === null) {
    const head = await reads().readFeedHead(owner, topic, window);
    if (head.kind === 'not-found') {
      return { copies: [], nextIndex: null, hidden: 0 };
    }
    if (head.kind !== 'content' || head.feedIndex === null) {
      throw new OwnCopiesUnreadableError();
    }
    newest = head.feedIndex;
  }

  const oldest = Math.max(0, newest - count + 1);
  const indices = Array.from({ length: newest - oldest + 1 }, (_, at) => newest - at);
  const read = await Promise.all(indices.map((index) => readCopy(index)));
  const copies = read.filter((copy): copy is OwnCopy => copy !== null);
  return { copies, nextIndex: oldest > 0 ? oldest - 1 : null, hidden: read.length - copies.length };

  async function readCopy(index: number): Promise<OwnCopy | null> {
    const read = await readOwnersChunk(
      reads(),
      owner,
      makeFeedIdentifier(topic, FeedIndex.fromBigInt(BigInt(index))),
      window,
    );
    if (read.kind !== 'chunk') {
      return null;
    }
    let signed: unknown;
    try {
      signed = JSON.parse(decoder.decode(read.chunk.payload));
    } catch {
      return null;
    }
    const verdict = await verify.verify(signed);
    if (!verdict.ok || verdict.message.addr.toLowerCase() !== owner || verdict.message.topic !== chatTopic) {
      return null;
    }
    return { index, message: verdict.message, identity: verdict.identity };
  }
}
