import { Bytes, ChunkBuilder, FeedIndex, type Identifier, PrivateKey, Span, Topic } from '@ethersphere/bee-js';
import { type ChatMessage, encodeChatMessage, MESSAGE_VERSION, ownFeedTopic } from '@solarpunkltd/swarm-chat-js';

import type { ChatReads } from '../../src/features/chat/chatParts';
import { makeFeedIdentifier } from '../../src/shared/feedFollow';
import type { SwarmAnswer } from '../../src/swarm/answers';
import { singleOwnerChunkAddress } from '../../src/swarm/singleOwnerChunk';

const encoder = new TextEncoder();

const NOT_FOUND: SwarmAnswer = { kind: 'not-found', serverTimeMs: null };

/** A single-owner chunk as Bee serves it at its address, signed by `key`. */
function socBytes(key: PrivateKey, identifier: Identifier, payload: Uint8Array): Uint8Array {
  const wrapped = new ChunkBuilder(BigInt(payload.length));
  wrapped.writer.buffer.set(payload);
  const signature = key.sign(Bytes.concat(identifier.toUint8Array(), wrapped.hash().toUint8Array()));
  return Bytes.concat(
    identifier.toUint8Array(),
    signature.toUint8Array(),
    Span.fromBigInt(BigInt(payload.length)).toUint8Array(),
    payload,
  );
}

/** A chunk's span, little-endian, then its payload, as weeb-3 serves the chunk a single-owner chunk wraps. */
export function wrappedChunk(payload: Uint8Array): Uint8Array {
  return Bytes.concat(Span.fromBigInt(BigInt(payload.length)).toUint8Array(), payload);
}

const content = (bytes: Uint8Array, feedIndex: number | null = null): SwarmAnswer => ({
  kind: 'content',
  bytes,
  feedIndex,
  serverTimeMs: null,
});

/** A reference as the server's history uploads return one, made from a counter so each file has its own. */
const referenceOf = (count: number) => count.toString(16).padStart(64, '0');

interface ChatFeedLayout {
  /** The last index each history file holds, oldest file first. Entries after the last are read from their slots. */
  readonly filesThrough?: readonly number[];
  /** Feed indices whose slot was never written. */
  readonly missingSlots?: readonly number[];
}

/**
 * Feeds served as a Bee gateway serves them, through one chat reader that logs every read: a chat feed as the chat
 * server writes it, with its entries and history files, and any number of senders' own feeds. Every other read
 * answers not found.
 */
export function servedFeeds() {
  const chunks = new Map<string, Uint8Array>();
  const heads = new Map<string, SwarmAnswer>();
  const files = new Map<string, Uint8Array>();
  const asked: string[] = [];

  const reads: ChatReads = {
    readFeedHead: async (owner, topic) => {
      asked.push(`head ${owner} ${topic.toHex()}`);
      return heads.get(`${owner}/${topic.toHex()}`) ?? NOT_FOUND;
    },
    readChunk: async (address) => {
      asked.push(`chunk ${address}`);
      const bytes = chunks.get(address);
      return bytes ? content(bytes) : NOT_FOUND;
    },
    readBytes: async (reference) => {
      asked.push(`bytes ${reference}`);
      const bytes = files.get(reference);
      return bytes ? content(bytes) : NOT_FOUND;
    },
  };

  /** Writes `payloads` at indices 0 and on of the feed `topic` of `key`, a null leaving that index unwritten. */
  function feed(key: string, topic: Topic, payloads: ReadonlyArray<Uint8Array | null>) {
    const signer = new PrivateKey(key);
    const owner = signer.publicKey().address().toHex();
    payloads.forEach((payload, index) => {
      if (payload) {
        const identifier = makeFeedIdentifier(topic, FeedIndex.fromBigInt(BigInt(index)));
        chunks.set(singleOwnerChunkAddress(identifier, owner), socBytes(signer, identifier, payload));
      }
    });
    const newest = payloads.length - 1;
    if (newest >= 0 && payloads[newest]) {
      heads.set(`${owner}/${topic.toHex()}`, content(payloads[newest]!, newest));
    }
    return owner;
  }

  /** A chat feed of `messages` at indices 0 and on, with its history files laid out as `layout` says. */
  function chat(serverKey: string, chatTopic: string, messages: readonly ChatMessage[], layout: ChatFeedLayout = {}) {
    const rows = messages.map((msg, seq) => ({ seq, at: 10_000 + seq, msg }));
    let link: { ref: string; toSeq: number } | null = null;
    const linkAfter = new Map<number, typeof link>();
    let fromSeq = 0;
    for (const toSeq of layout.filesThrough ?? []) {
      const ref = referenceOf(files.size + 1);
      const file = {
        v: MESSAGE_VERSION,
        topic: chatTopic,
        fromSeq,
        toSeq,
        messages: rows.slice(fromSeq, toSeq + 1),
        prev: link,
      };
      files.set(ref, encoder.encode(JSON.stringify(file)));
      link = { ref, toSeq };
      linkAfter.set(toSeq, link);
      fromSeq = toSeq + 1;
    }
    let newestLink: typeof link = null;
    const entries = rows.map((row) => {
      const entry = encoder.encode(JSON.stringify({ v: MESSAGE_VERSION, ...row, history: newestLink }));
      newestLink = linkAfter.get(row.seq) ?? newestLink;
      return layout.missingSlots?.includes(row.seq) ? null : entry;
    });
    return feed(serverKey, Topic.fromString(chatTopic), entries);
  }

  /** A sender's own feed of copies for chat `chatTopic`. */
  function ownFeed(senderKey: string, chatTopic: string, copies: ReadonlyArray<ChatMessage | Uint8Array | null>) {
    const payloads = copies.map((copy) =>
      copy === null || copy instanceof Uint8Array ? copy : encodeChatMessage(copy),
    );
    return feed(senderKey, Topic.fromString(ownFeedTopic(chatTopic)), payloads);
  }

  return { reads, asked, chat, ownFeed, heads };
}
