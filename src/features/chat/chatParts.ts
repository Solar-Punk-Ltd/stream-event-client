import { FeedIndex, Topic } from '@ethersphere/bee-js';
import {
  type ChatParts,
  type ChatSettings,
  type ChatSource,
  DEFAULT_NOTE_SLOT_MS,
  HeadLookupTimeoutError,
  noteIdentifier,
  UnreadableSlotError,
} from '@solarpunkltd/swarm-chat-js';

import { makeFeedIdentifier } from '@/shared/feedFollow';
import type { SwarmAnswer } from '@/swarm/answers';
import type { SwarmReader } from '@/swarm/client';
import type { ReadOptions } from '@/swarm/provider';
import { beeGsocWrite } from '@/swarm/providers/bee-http/gsocWrite';
import { MAX_CHUNK_PAYLOAD, parseSingleOwnerChunk, singleOwnerChunkAddress } from '@/swarm/singleOwnerChunk';

/** What the chat reads Swarm through, which the client routes to the event's chat read address. */
export type ChatReads = Pick<SwarmReader, 'readFeedHead' | 'readChunk' | 'readBytes'>;

/** The library's own waits when its settings name none, kept so the adapter reads on the same clock. */
const SLOT_READ_MS = 5_000;
const FEED_READ_MS = 15_000;
const WRITE_MS = 10_000;

/** The status a Bee 2.6 cluster answers `GET /chunks` with for a slot never written. */
const ABSENT_ON_A_CLUSTER = 500;

/**
 * Whether an answer says the chunk is not there, by the library's own rule: Bee's 404, and the 500 a
 * cluster answers for a slot never written, as bee-js's `isRetrievable` counts it. Neither ever means
 * the chat has ended, and one that is wrong about "not there" is asked again on the next poll.
 */
function isAbsent(answer: SwarmAnswer): boolean {
  return (
    answer.kind === 'not-found' ||
    (answer.kind === 'unavailable' && answer.cause.kind === 'status' && answer.cause.status === ABSENT_ON_A_CLUSTER)
  );
}

/** The gateway failing, as the library expects a source to reject with it. */
function gatewayFailure(answer: SwarmAnswer, what: string): Error {
  if (answer.kind === 'unavailable' && answer.cause.kind === 'network' && answer.cause.error instanceof Error) {
    return answer.cause.error;
  }
  return new Error(`the chat's read of ${what} answered ${describe(answer)}`);
}

function describe(answer: SwarmAnswer): string {
  if (answer.kind === 'unavailable') {
    return answer.cause.kind === 'status' ? `status ${answer.cause.status}` : `unavailable (${answer.cause.kind})`;
  }
  return answer.kind;
}

/** Hex as bee-js writes it into a path, so the reads ask the URLs the library always asked. */
function bareHex(hex: string): string {
  return (hex.startsWith('0x') ? hex.slice(2) : hex).toLowerCase();
}

interface ChatSourceOptions {
  /** The client's chat reader as it is now, read on every call, so a client rebuilt for another node is followed. */
  readonly reads: () => ChatReads;
  readonly owner: string;
  readonly chatTopic: string;
  readonly slotReadMs: number;
  readonly feedReadMs: number;
  readonly noteSlotMs: number;
}

/**
 * The library's `ChatSource` over the Swarm client: the same reads the library's own Bee source makes,
 * at the same URLs, sorted into what the library expects. A slot and a note are single-owner chunks
 * read by their address and checked to be the chat owner's, a chunk that fails that check rejects as
 * an `UnreadableSlotError`, and 404 and 500 both mean the chunk is not there.
 */
function chatSource(options: ChatSourceOptions): ChatSource {
  const { reads, chatTopic, slotReadMs, feedReadMs, noteSlotMs } = options;
  const owner = bareHex(options.owner);
  const topic = Topic.fromString(chatTopic);
  const slotWindow: ReadOptions = { timeoutMs: slotReadMs };
  const feedWindow: ReadOptions = { timeoutMs: feedReadMs };

  /** The payload of the owner's single-owner chunk at an address, or null when it is not there. */
  async function readOwnersChunk(address: string, index: number, readsTree: boolean): Promise<Uint8Array | null> {
    const answer = await reads().readChunk(address, slotWindow);
    if (isAbsent(answer)) {
      return null;
    }
    if (answer.kind !== 'content') {
      throw gatewayFailure(answer, `chunk ${address}`);
    }
    let chunk;
    try {
      chunk = parseSingleOwnerChunk(answer.bytes, address);
    } catch (error) {
      throw new UnreadableSlotError(index, { cause: error });
    }
    if (!readsTree || chunk.span <= BigInt(MAX_CHUNK_PAYLOAD)) {
      return chunk.payload;
    }
    // A payload too big for one chunk is the root of a tree, read whole by its address, as bee-js does.
    const tree = await reads().readBytes(chunk.wrappedAddress, slotWindow);
    if (tree.kind !== 'content') {
      throw gatewayFailure(tree, `the bytes of slot ${index}`);
    }
    return tree.bytes;
  }

  return {
    readSlot: (index) =>
      readOwnersChunk(
        singleOwnerChunkAddress(makeFeedIdentifier(topic, FeedIndex.fromBigInt(BigInt(index))), owner),
        index,
        true,
      ),

    readNote: (slot) =>
      readOwnersChunk(singleOwnerChunkAddress(noteIdentifier(chatTopic, noteSlotMs, slot), owner), slot, false),

    async readHead() {
      const answer = await reads().readFeedHead(owner, topic, feedWindow);
      if (isAbsent(answer)) {
        return null;
      }
      if (answer.kind === 'unavailable' && answer.cause.kind === 'timeout') {
        throw new HeadLookupTimeoutError({ cause: new Error(`no answer in ${answer.cause.timeoutMs} ms`) });
      }
      if (answer.kind !== 'content') {
        throw gatewayFailure(answer, 'the chat feed head');
      }
      if (answer.feedIndex === null) {
        throw new Error('the chat feed head came back without the index it resolved to');
      }
      return { index: answer.feedIndex, payload: answer.bytes };
    },

    async readFile(reference) {
      const answer = await reads().readBytes(reference, feedWindow);
      if (answer.kind !== 'content') {
        throw gatewayFailure(answer, `history file ${reference}`);
      }
      return answer.bytes;
    },
  };
}

/**
 * The two parts swarm-chat-js takes in place of reaching Bee itself: its reads, through the Swarm
 * client's chat reader, and its one write. A message always goes to the event's chat write address,
 * because it costs a stamp the viewer does not hold, so the write is the library's own, unchanged.
 *
 * @param reads The client's chat reader as it is now, see {@link ChatSourceOptions.reads}.
 */
export function chatParts(settings: ChatSettings, reads: () => ChatReads): Pick<ChatParts, 'source' | 'write'> {
  const { infra } = settings;
  return {
    source: chatSource({
      reads,
      owner: infra.chatAddress,
      chatTopic: infra.chatTopic,
      slotReadMs: infra.socReadTimeout ?? SLOT_READ_MS,
      feedReadMs: infra.feedReadTimeout ?? FEED_READ_MS,
      noteSlotMs: infra.noteSlotMs ?? DEFAULT_NOTE_SLOT_MS,
    }),
    write: beeGsocWrite({
      url: infra.writeUrl ?? infra.beeUrl,
      gsocKey: bareHex(infra.gsocResourceId),
      gsocTopic: infra.gsocTopic,
      timeoutMs: infra.gsocWriteTimeout ?? WRITE_MS,
      stamp: infra.stamp,
    }),
  };
}
