import { Bytes, ChunkBuilder, FeedIndex, type Identifier, PrivateKey, Span, Topic } from '@ethersphere/bee-js';
import { ownFeedTopic } from '@solarpunkltd/swarm-chat-js';

import type { ChatReads } from '../../src/features/chat/chatParts';
import { makeFeedIdentifier } from '../../src/shared/feedFollow';
import type { SwarmAnswer } from '../../src/swarm/answers';
import { singleOwnerChunkAddress } from '../../src/swarm/singleOwnerChunk';

/** A single-owner chunk as Bee serves it at its address, signed by `key`. */
export function socBytes(key: PrivateKey, identifier: Identifier, payload: Uint8Array): Uint8Array {
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

const content = (bytes: Uint8Array, feedIndex: number | null = null): SwarmAnswer => ({
  kind: 'content',
  bytes,
  feedIndex,
  serverTimeMs: null,
});
export const NOT_FOUND: SwarmAnswer = { kind: 'not-found', serverTimeMs: null };

/**
 * A sender's own feed for chat `chatTopic`, holding `payloads` at indices 0 and on, signed by `senderKey`, and a chat
 * reader that serves it and logs every read. Any other chunk is not there.
 */
export function ownFeed(senderKey: string, chatTopic: string, payloads: Uint8Array[]) {
  const sender = new PrivateKey(senderKey);
  const owner = sender.publicKey().address().toHex();
  const topic = Topic.fromString(ownFeedTopic(chatTopic));
  const identifierAt = (index: number) => makeFeedIdentifier(topic, FeedIndex.fromBigInt(BigInt(index)));
  const addressAt = (index: number) => singleOwnerChunkAddress(identifierAt(index), owner);
  const asked: string[] = [];
  const chunks = new Map(
    payloads.map((payload, index) => [addressAt(index), socBytes(sender, identifierAt(index), payload)]),
  );
  const reads: ChatReads = {
    readFeedHead: async (headOwner, headTopic) => {
      asked.push(`head ${headOwner} ${headTopic.toHex()}`);
      if (headOwner !== owner || headTopic.toHex() !== topic.toHex() || payloads.length === 0) {
        return NOT_FOUND;
      }
      return content(payloads[payloads.length - 1], payloads.length - 1);
    },
    readChunk: async (address) => {
      asked.push(`chunk ${address}`);
      const bytes = chunks.get(address);
      return bytes ? content(bytes) : NOT_FOUND;
    },
    readBytes: async () => NOT_FOUND,
  };
  /** The same feed as the node in this browser serves it: each entry's wrapped chunk without its signature. */
  const unsignedReads: ChatReads = {
    ...reads,
    readChunk: async (address) => {
      asked.push(`chunk ${address}`);
      return { kind: 'unsupported' };
    },
    readUnsignedSoc: async (socOwner, identifier) => {
      asked.push(`unsigned ${socOwner} ${identifier}`);
      const index = payloads.findIndex((_, at) => socOwner === owner && identifierAt(at).toHex() === identifier);
      return index === -1 ? NOT_FOUND : content(wrappedChunk(payloads[index]));
    },
  };
  return { reads, unsignedReads, asked, chunks, owner, topic, identifierAt, addressAt };
}

/** A chunk's span, little-endian, then its payload, as weeb-3 serves the chunk a single-owner chunk wraps. */
export function wrappedChunk(payload: Uint8Array): Uint8Array {
  return Bytes.concat(Span.fromBigInt(BigInt(payload.length)).toUint8Array(), payload);
}
