import { Bytes, ChunkBuilder, Identifier, PrivateKey, Span } from '@ethersphere/bee-js';
import { describe, expect, it } from 'vitest';

import { MAX_CHUNK_PAYLOAD, parseSingleOwnerChunk, singleOwnerChunkAddress } from '../../src/swarm/singleOwnerChunk';
import { firstRecordedPath, RECORDED_GATEWAY, recordedBody } from '../helpers/recordedBeeGateway';

/** A throwaway key that signs only these test chunks. */
const KEY = new PrivateKey('a1'.repeat(32));
const OWNER = KEY.publicKey().address().toHex();
const IDENTIFIER = Identifier.fromString('single-owner-chunk-test');

/** A single-owner chunk as an owner writes one, so a test holds one whose every byte it chose. */
function writeChunk(payload: Uint8Array, span = BigInt(payload.length)): Uint8Array {
  const wrapped = new ChunkBuilder(span);
  wrapped.writer.buffer.set(payload);
  const signature = KEY.sign(Bytes.concat(IDENTIFIER.toUint8Array(), wrapped.hash().toUint8Array()));
  return Bytes.concat(
    IDENTIFIER.toUint8Array(),
    signature.toUint8Array(),
    Span.fromBigInt(span).toUint8Array(),
    payload,
  );
}

const ADDRESS = singleOwnerChunkAddress(IDENTIFIER, OWNER);
const PAYLOAD = new TextEncoder().encode('a message the chat wrote');

describe('a single-owner chunk read by its address', () => {
  it("gives the payload, the span and the owner of a chunk that is its owner's", () => {
    const chunk = parseSingleOwnerChunk(writeChunk(PAYLOAD), ADDRESS);

    expect(chunk.payload).toEqual(PAYLOAD);
    expect(chunk.span).toBe(BigInt(PAYLOAD.length));
    expect(chunk.owner).toBe(OWNER);
  });

  it('reads a chunk the recording served, as Bee stores one', () => {
    const address = firstRecordedPath('chunks').slice('chunks/'.length);

    expect(() => parseSingleOwnerChunk(recordedBody(`${RECORDED_GATEWAY}/chunks/${address}`), address)).not.toThrow();
  });

  it('refuses a chunk whose payload was changed, since the signature no longer names its owner', () => {
    const tampered = writeChunk(PAYLOAD);
    tampered[tampered.length - 1] ^= 1;

    expect(() => parseSingleOwnerChunk(tampered, ADDRESS)).toThrow('is not the single-owner chunk');
  });

  it('refuses a good chunk served for another address', () => {
    expect(() => parseSingleOwnerChunk(writeChunk(PAYLOAD), 'cd'.repeat(32))).toThrow('is not the single-owner chunk');
  });

  it('refuses bytes too short to be one', () => {
    expect(() => parseSingleOwnerChunk(new Uint8Array(40), ADDRESS)).toThrow('at least');
  });

  it("names the wrapped chunk of a tree's root, whose span is more than one chunk", () => {
    const chunk = parseSingleOwnerChunk(writeChunk(PAYLOAD, BigInt(MAX_CHUNK_PAYLOAD * 3)), ADDRESS);

    expect(chunk.span).toBe(BigInt(MAX_CHUNK_PAYLOAD * 3));
    expect(chunk.wrappedAddress).toMatch(/^[0-9a-f]{64}$/);
  });
});
