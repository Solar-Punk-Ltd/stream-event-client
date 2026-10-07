import { Bytes, ChunkBuilder, FeedIndex, Identifier, PrivateKey, Span, Topic } from '@ethersphere/bee-js';
import {
  type ChatSettings,
  DEFAULT_NOTE_SLOT_MS,
  HeadLookupTimeoutError,
  noteIdentifier,
  UnreadableSlotError,
} from '@solarpunkltd/swarm-chat-js';
import { afterEach, describe, expect, it } from 'vitest';

import { type ChatReads, chatParts } from '../../src/features/chat/chatParts';
import { makeFeedIdentifier } from '../../src/shared/feedFollow';
import type { SwarmAnswer } from '../../src/swarm/answers';
import { SwarmClient } from '../../src/swarm/client';
import { BeeHttpProvider } from '../../src/swarm/providers/bee-http/beeHttpProvider';
import { singleOwnerChunkAddress } from '../../src/swarm/singleOwnerChunk';
import {
  type AskedLog,
  RECORDED_GATEWAY,
  recordedChatSettings,
  recordedFetch,
  recordedUrls,
} from '../helpers/recordedBeeGateway';

/** A throwaway key standing in for the chat server, which owns the chat feed and its notes. */
const SERVER = new PrivateKey('b2'.repeat(32));
const OWNER = SERVER.publicKey().address().toHex();
const CHAT_TOPIC = 'chat-a-stream';
const READ_URL = 'https://chat-read.example.com';
const WRITE_URL = 'https://chat-write.example.com';

function settings(): ChatSettings {
  return {
    user: { privateKey: 'c3'.repeat(32), nickname: '' },
    infra: {
      beeUrl: READ_URL,
      writeUrl: WRITE_URL,
      gsocResourceId: 'd4'.repeat(32),
      gsocTopic: 'the-inbox',
      chatTopic: CHAT_TOPIC,
      chatAddress: `0x${OWNER.toUpperCase()}`,
      feedReadTimeout: 12_500,
      gsocWriteTimeout: 5_000,
      socReadTimeout: 5_000,
    },
  };
}

/** The single-owner chunk the server writes under an identifier, as Bee serves it at its address. */
function serverChunk(identifier: Identifier, payload: Uint8Array): Uint8Array {
  const wrapped = new ChunkBuilder(BigInt(payload.length));
  wrapped.writer.buffer.set(payload);
  const signature = SERVER.sign(Bytes.concat(identifier.toUint8Array(), wrapped.hash().toUint8Array()));
  return Bytes.concat(
    identifier.toUint8Array(),
    signature.toUint8Array(),
    Span.fromBigInt(BigInt(payload.length)).toUint8Array(),
    payload,
  );
}

const slotIdentifier = (index: number) =>
  makeFeedIdentifier(Topic.fromString(CHAT_TOPIC), FeedIndex.fromBigInt(BigInt(index)));
const slotAddress = (index: number) => singleOwnerChunkAddress(slotIdentifier(index), OWNER);
const noteAddressOf = (slot: number) =>
  singleOwnerChunkAddress(noteIdentifier(CHAT_TOPIC, DEFAULT_NOTE_SLOT_MS, slot), OWNER);

const ENTRY = new TextEncoder().encode('{"a":"chat entry"}');

const content = (bytes: Uint8Array, feedIndex: number | null = null): SwarmAnswer => ({
  kind: 'content',
  bytes,
  feedIndex,
  serverTimeMs: null,
});
const NOT_FOUND: SwarmAnswer = { kind: 'not-found', serverTimeMs: null };
const STATUS = (status: number): SwarmAnswer => ({ kind: 'unavailable', cause: { kind: 'status', status } });

interface Asked {
  readonly read: 'feed-head' | 'chunk' | 'bytes';
  readonly at: string;
  readonly timeoutMs?: number;
}

/** A fake of the reads the adapter is given, answering each address as the test says. */
function readsAnswering(answers: Record<string, SwarmAnswer>, asked: Asked[] = []): ChatReads {
  const answer = (at: string) => answers[at] ?? NOT_FOUND;
  return {
    readFeedHead: async (owner, topic, options) => {
      const at = `${owner}/${topic.toString()}`;
      asked.push({ read: 'feed-head', at, timeoutMs: options?.timeoutMs });
      return answer(at);
    },
    readChunk: async (address, options) => {
      asked.push({ read: 'chunk', at: address, timeoutMs: options?.timeoutMs });
      return answer(address);
    },
    readBytes: async (reference, options) => {
      asked.push({ read: 'bytes', at: reference, timeoutMs: options?.timeoutMs });
      return answer(reference);
    },
  };
}

function sourceOver(reads: ChatReads) {
  return chatParts(settings(), () => reads).source;
}

describe("the chat's source over the Swarm client", () => {
  describe('a slot', () => {
    it("reads the server's chunk at the slot's address, in the slot read's window, and gives its payload", async () => {
      const asked: Asked[] = [];
      const source = sourceOver(
        readsAnswering({ [slotAddress(3)]: content(serverChunk(slotIdentifier(3), ENTRY)) }, asked),
      );

      expect(await source.readSlot(3)).toEqual(ENTRY);
      expect(asked).toEqual([{ read: 'chunk', at: slotAddress(3), timeoutMs: 5_000 }]);
    });

    it('is absent for a 404 and for the 500 a cluster answers for a slot never written', async () => {
      expect(await sourceOver(readsAnswering({ [slotAddress(1)]: NOT_FOUND })).readSlot(1)).toBeNull();
      expect(await sourceOver(readsAnswering({ [slotAddress(1)]: STATUS(500) })).readSlot(1)).toBeNull();
    });

    it("rejects as unreadable a chunk served that is not the server's", async () => {
      const forged = serverChunk(slotIdentifier(2), ENTRY);
      forged[forged.length - 1] ^= 1;

      await expect(
        sourceOver(readsAnswering({ [slotAddress(2)]: content(forged) })).readSlot(2),
      ).rejects.toBeInstanceOf(UnreadableSlotError);
    });

    it('rejects with the gateway failing, not as unreadable, when the gateway did not answer', async () => {
      const failing = readsAnswering({ [slotAddress(4)]: STATUS(502) });

      const error = await sourceOver(failing)
        .readSlot(4)
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(UnreadableSlotError);
    });
  });

  describe('a note', () => {
    it("reads the server's chunk at the note's address and gives its payload", async () => {
      const identifier = noteIdentifier(CHAT_TOPIC, DEFAULT_NOTE_SLOT_MS, 77);
      const note = new TextEncoder().encode('{"note":77}');
      const asked: Asked[] = [];
      const source = sourceOver(readsAnswering({ [noteAddressOf(77)]: content(serverChunk(identifier, note)) }, asked));

      expect(await source.readNote?.(77)).toEqual(note);
      expect(asked).toEqual([{ read: 'chunk', at: noteAddressOf(77), timeoutMs: 5_000 }]);
    });

    it('is absent for a 404 and a 500, as a slot is', async () => {
      expect(await sourceOver(readsAnswering({})).readNote?.(78)).toBeNull();
      expect(await sourceOver(readsAnswering({ [noteAddressOf(78)]: STATUS(500) })).readNote?.(78)).toBeNull();
    });
  });

  describe('the head', () => {
    const headAt = `${OWNER}/${Topic.fromString(CHAT_TOPIC).toString()}`;

    it("gives the index the node resolved and its payload, asking by the owner's bare lowercase hex", async () => {
      const asked: Asked[] = [];
      const source = sourceOver(readsAnswering({ [headAt]: content(ENTRY, 41) }, asked));

      expect(await source.readHead()).toEqual({ index: 41, payload: ENTRY });
      expect(asked).toEqual([{ read: 'feed-head', at: headAt, timeoutMs: 12_500 }]);
    });

    it('is absent for a 404 and a 500', async () => {
      expect(await sourceOver(readsAnswering({ [headAt]: NOT_FOUND })).readHead()).toBeNull();
      expect(await sourceOver(readsAnswering({ [headAt]: STATUS(500) })).readHead()).toBeNull();
    });

    it('rejects as a head lookup timeout when the window ran out', async () => {
      const slow: SwarmAnswer = { kind: 'unavailable', cause: { kind: 'timeout', timeoutMs: 12_500 } };

      await expect(sourceOver(readsAnswering({ [headAt]: slow })).readHead()).rejects.toBeInstanceOf(
        HeadLookupTimeoutError,
      );
    });

    it('rejects when the node did not say which index it resolved', async () => {
      await expect(sourceOver(readsAnswering({ [headAt]: content(ENTRY, null) })).readHead()).rejects.toThrow();
    });
  });

  describe('a history file', () => {
    const REFERENCE = 'ef'.repeat(32);

    it("gives the file's bytes, in the feed read's window", async () => {
      const asked: Asked[] = [];

      expect(await sourceOver(readsAnswering({ [REFERENCE]: content(ENTRY) }, asked)).readFile(REFERENCE)).toEqual(
        ENTRY,
      );
      expect(asked).toEqual([{ read: 'bytes', at: REFERENCE, timeoutMs: 12_500 }]);
    });

    it('rejects when it cannot be read, a 404 included', async () => {
      await expect(sourceOver(readsAnswering({})).readFile(REFERENCE)).rejects.toThrow();
    });
  });

  it('reads through the client as it is when each read is made, so a client rebuilt for another node is followed', async () => {
    const first: Asked[] = [];
    const second: Asked[] = [];
    let reads = readsAnswering({}, first);
    const { source } = chatParts(settings(), () => reads);

    await source.readSlot(0);
    reads = readsAnswering({}, second);
    await source.readSlot(0);

    expect([first.length, second.length]).toEqual([1, 1]);
  });
});

describe("the chat's source on the recording the browser smoke test replays", () => {
  it('asks only URLs the chat library asked when the recording was made', async () => {
    const log: AskedLog = { urls: [] };
    const provider = new BeeHttpProvider({ baseUrl: RECORDED_GATEWAY, fetcher: recordedFetch(log) });
    const client = new SwarmClient({ chosen: { id: 'chat-read', provider } });
    const { source } = chatParts(recordedChatSettings(), () => client.reader('chat'));

    const head = await source.readHead();
    expect(head).not.toBeNull();
    await source.readSlot(head!.index);
    await source.readSlot(head!.index + 1);

    expect(log.urls.length).toBe(3);
    expect(recordedUrls()).toEqual(expect.arrayContaining(log.urls));
  });
});

describe("the chat's write", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('posts one single-owner chunk to the inbox at the write address, never deferred', async () => {
    const posted: { url: string; method: string | undefined; deferred: string | null }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      posted.push({
        url: String(input),
        method: init?.method,
        deferred: new Headers(init?.headers).get('swarm-deferred-upload'),
      });
      return new Response(JSON.stringify({ reference: 'ab'.repeat(32) }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    await chatParts(settings(), () => readsAnswering({})).write(new TextEncoder().encode('hello'));

    expect(posted).toHaveLength(1);
    expect(posted[0].url.startsWith(`${WRITE_URL}/soc/`)).toBe(true);
    expect(posted[0].method?.toUpperCase()).toBe('POST');
    expect(posted[0].deferred).toBe('false');
  });
});
