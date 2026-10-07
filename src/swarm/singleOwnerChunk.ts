import { Bytes, ChunkBuilder, EthAddress, Identifier, Signature, Span } from '@ethersphere/bee-js';

// A single-owner chunk is the identifier, the owner's signature, then the content-addressed chunk it
// wraps, its span and its payload. These are the offsets Bee and bee-js lay it out at.
const IDENTIFIER_LENGTH = 32;
const SIGNATURE_LENGTH = 65;
const SPAN_OFFSET = IDENTIFIER_LENGTH + SIGNATURE_LENGTH;
const SPAN_LENGTH = 8;
const PAYLOAD_OFFSET = SPAN_OFFSET + SPAN_LENGTH;

/** The most payload one chunk carries. A span past it says the payload is the root of a tree of chunks. */
export const MAX_CHUNK_PAYLOAD = 4096;

/** What a single-owner chunk read by its address holds, once it has proved to be its owner's. */
export interface SingleOwnerChunk {
  /** How many bytes the wrapped chunk stands for, which is more than its payload for a tree's root. */
  readonly span: bigint;
  readonly payload: Uint8Array;
  /** The address of the content-addressed chunk it wraps, which the bytes of a tree are read from. */
  readonly wrappedAddress: string;
  /** Its owner, as 40 hex digits without `0x`. */
  readonly owner: string;
}

/** The address an owner's single-owner chunk under an identifier is stored at, as 64 hex digits. */
export function singleOwnerChunkAddress(identifier: Identifier, owner: string): string {
  return Bytes.keccak256(Bytes.concat(identifier.toUint8Array(), new EthAddress(owner).toUint8Array())).toHex();
}

/**
 * A single-owner chunk read by its address, checked as bee-js checks it: the owner is recovered from
 * the signature over the identifier and the wrapped chunk's address, and the identifier and that
 * owner must make the address it was read from. A gateway can serve any bytes at any address, so this
 * is what makes them the owner's.
 *
 * @throws When the bytes are too short to be one, or are not the chunk at `address`.
 */
export function parseSingleOwnerChunk(data: Uint8Array, address: string): SingleOwnerChunk {
  if (data.length < PAYLOAD_OFFSET) {
    throw new Error(`a single-owner chunk is at least ${PAYLOAD_OFFSET} bytes, this one is ${data.length}`);
  }
  const identifier = new Identifier(data.slice(0, IDENTIFIER_LENGTH));
  const signature = new Signature(data.slice(IDENTIFIER_LENGTH, SPAN_OFFSET));
  const span = Span.fromSlice(data, SPAN_OFFSET).toBigInt();
  const payload = data.slice(PAYLOAD_OFFSET);
  if (payload.length > MAX_CHUNK_PAYLOAD) {
    throw new Error(`a chunk carries at most ${MAX_CHUNK_PAYLOAD} bytes of payload, this one ${payload.length}`);
  }

  const wrapped = new ChunkBuilder(span);
  wrapped.writer.buffer.set(payload);
  const wrappedAddress = wrapped.hash();

  const owner = signature
    .recoverPublicKey(Bytes.concat(identifier.toUint8Array(), wrappedAddress.toUint8Array()))
    .address()
    .toHex();
  if (singleOwnerChunkAddress(identifier, owner) !== address.toLowerCase()) {
    throw new Error(`the chunk served for ${address} is not the single-owner chunk at that address`);
  }
  return { span, payload, wrappedAddress: wrappedAddress.toHex(), owner };
}
