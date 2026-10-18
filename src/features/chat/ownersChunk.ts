import { ChunkBuilder, type Identifier } from '@ethersphere/bee-js';

import type { SwarmAnswer } from '@/swarm/answers';
import { bodyLengthOf, SPAN_LENGTH, storedSpanOf } from '@/swarm/chunkSpan';
import type { SwarmReader } from '@/swarm/client';
import type { ReadOptions } from '@/swarm/provider';
import { MAX_CHUNK_PAYLOAD, parseSingleOwnerChunk, singleOwnerChunkAddress } from '@/swarm/singleOwnerChunk';

/** The reads an owner's single-owner chunk is read through: by its address, or without its signature where served so. */
type OwnersChunkReads = Pick<SwarmReader, 'readChunk' | 'readUnsignedSoc'>;

/** What an owner's single-owner chunk holds, once read. */
interface OwnersChunk {
  /** How many bytes the wrapped chunk stands for, which is more than its payload for a tree's root. */
  readonly bodyLength: bigint;
  readonly payload: Uint8Array;
  /** The address of the content-addressed chunk it wraps, which the bytes of a tree are read from. */
  readonly wrappedAddress: string;
}

type OwnersChunkRead =
  | { readonly kind: 'chunk'; readonly chunk: OwnersChunk }
  /** Something was served that is not the owner's chunk at that address, or not a chunk at all. */
  | { readonly kind: 'unreadable'; readonly error: unknown }
  /** Any answer but content: not found, a fault, a rate limit. */
  | { readonly kind: 'answer'; readonly answer: Exclude<SwarmAnswer, { kind: 'content' }> };

function wrappedChunkOf(bytes: Uint8Array): OwnersChunk {
  if (bytes.length < SPAN_LENGTH || bytes.length - SPAN_LENGTH > MAX_CHUNK_PAYLOAD) {
    throw new Error(`a chunk is a span and at most ${MAX_CHUNK_PAYLOAD} bytes of payload, this one is ${bytes.length}`);
  }
  const payload = bytes.slice(SPAN_LENGTH);
  const wrapped = new ChunkBuilder(storedSpanOf(bytes));
  wrapped.writer.buffer.set(payload);
  return { bodyLength: bodyLengthOf(bytes), payload, wrappedAddress: wrapped.hash().toHex() };
}

/**
 * An owner's single-owner chunk under an identifier, read through the reader as it is. Where the reader's source
 * serves the whole single-owner chunk, it is read by its address and checked to be the owner's here. Where the source
 * serves it without its signature, the node in this browser, the chunk it wraps is read by the owner and identifier,
 * and whose it is rests on that node's word. Every message in a chat is signed by its sender and checked apart from
 * this, so a chunk that is not the owner's can at most carry messages someone signed.
 */
export async function readOwnersChunk(
  reads: OwnersChunkReads,
  owner: string,
  identifier: Identifier,
  options: ReadOptions,
): Promise<OwnersChunkRead> {
  if (reads.readUnsignedSoc) {
    const answer = await reads.readUnsignedSoc(owner, identifier.toHex(), options);
    if (answer.kind !== 'content') {
      return { kind: 'answer', answer };
    }
    try {
      return { kind: 'chunk', chunk: wrappedChunkOf(answer.bytes) };
    } catch (error) {
      return { kind: 'unreadable', error };
    }
  }
  const address = singleOwnerChunkAddress(identifier, owner);
  const answer = await reads.readChunk(address, options);
  if (answer.kind !== 'content') {
    return { kind: 'answer', answer };
  }
  try {
    const { bodyLength, payload, wrappedAddress, owner: signer } = parseSingleOwnerChunk(answer.bytes, address);
    if (signer.toLowerCase() !== owner.replace(/^0x/, '').toLowerCase()) {
      throw new Error(`the chunk at ${address} is not signed by ${owner}`);
    }
    return { kind: 'chunk', chunk: { bodyLength, payload, wrappedAddress } };
  } catch (error) {
    return { kind: 'unreadable', error };
  }
}
