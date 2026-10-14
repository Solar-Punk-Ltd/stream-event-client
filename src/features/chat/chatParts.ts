import { FeedIndex, type Identifier, Topic } from '@ethersphere/bee-js';
import {
  type ChatParts,
  type ChatSettings,
  type ChatSource,
  DEFAULT_NOTE_SLOT_MS,
  HeadLookupTimeoutError,
  MessageVia,
  noteIdentifier,
  UnreadableSlotError,
} from '@solarpunkltd/swarm-chat-js';

import { makeFeedIdentifier } from '@/shared/feedFollow';
import type { SwarmAnswer } from '@/swarm/answers';
import type { SwarmReader } from '@/swarm/client';
import type { ReadOptions } from '@/swarm/provider';
import { beeGsocWrite } from '@/swarm/providers/bee-http/gsocWrite';
import { MAX_CHUNK_PAYLOAD } from '@/swarm/singleOwnerChunk';

import { readOwnersChunk } from './ownersChunk';

import { type ChunkStamper, ownStampWrite, type SendProblem, type StampedPush } from './stamp/ownStampWrite';

/** What the chat reads Swarm through, which the client routes to the event's chat read address. */
export type ChatReads = Pick<SwarmReader, 'readFeedHead' | 'readChunk' | 'readUnsignedSoc' | 'readBytes'>;

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
 * at the same URLs, sorted into what the library expects. A slot and a note are the chat owner's single-owner chunks,
 * read as {@link readOwnersChunk} reads them, a chunk that fails its check rejects as an `UnreadableSlotError`, and
 * 404 and 500 both mean the chunk is not there.
 */
function chatSource(options: ChatSourceOptions): ChatSource {
  const { reads, chatTopic, slotReadMs, feedReadMs, noteSlotMs } = options;
  const owner = bareHex(options.owner);
  const topic = Topic.fromString(chatTopic);
  const slotWindow: ReadOptions = { timeoutMs: slotReadMs };
  const feedWindow: ReadOptions = { timeoutMs: feedReadMs };

  /** The payload of the owner's single-owner chunk under an identifier, or null when it is not there. */
  async function readOwnersPayload(
    identifier: Identifier,
    index: number,
    readsTree: boolean,
  ): Promise<Uint8Array | null> {
    const read = await readOwnersChunk(reads(), owner, identifier, slotWindow);
    if (read.kind === 'answer') {
      if (isAbsent(read.answer)) {
        return null;
      }
      throw gatewayFailure(read.answer, `chunk ${identifier.toHex()} of ${owner}`);
    }
    if (read.kind === 'unreadable') {
      throw new UnreadableSlotError(index, { cause: read.error });
    }
    const { chunk } = read;
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
    readSlot: (index) => readOwnersPayload(makeFeedIdentifier(topic, FeedIndex.fromBigInt(BigInt(index))), index, true),

    readNote: (slot) => readOwnersPayload(noteIdentifier(chatTopic, noteSlotMs, slot), slot, false),

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

/** What a chat on the viewer's own stamp needs beside its settings, which are compared by value and cannot hold it. */
interface OwnStampParts {
  /** Read at every write: Swarm ID while the viewer is signed in with it, null otherwise. */
  readonly stamper: () => ChunkStamper | null;
  /** Whether each message also gets a copy in the sender's own feed. */
  readonly ownFeed: boolean;
  /** Read at every write: why the page cannot send on the viewer's stamp now, or null when it can. */
  readonly refusal?: () => string | null;
  readonly onProblem?: (messageId: string, problem: SendProblem) => void;
  readonly onSent?: () => void;
  /** Read at every write: how a stamped chunk goes out through the node in this browser, or null while it does not. */
  readonly push?: () => StampedPush | null;
}

/** The library's parts, and the way to let a message refused on the viewer's stamp be tried again. */
export interface ChatPartsForPage extends Pick<ChatParts, 'source' | 'write'> {
  forgetRefusal(messageId: string): void;
}

const NOTHING_REFUSED = () => {};

/**
 * The two parts swarm-chat-js takes in place of reaching Bee itself: its reads, through the Swarm client's chat
 * reader, and its one write. While the event pays, a message goes to the event's chat write address, which stamps it,
 * through the library's own write, unchanged. On the viewer's own stamp it is stamped by Swarm ID and goes to their Bee
 * node at `writeUrl`, or through the node in this browser where the chat reads from it, and never anywhere else. With
 * neither it is refused.
 *
 * @param reads The client's chat reader as it is now, see {@link ChatSourceOptions.reads}.
 * @throws When the settings say the viewer's own stamp and nothing can stamp.
 */
export function chatParts(settings: ChatSettings, reads: () => ChatReads, ownStamp?: OwnStampParts): ChatPartsForPage {
  const { infra } = settings;
  const source = chatSource({
    reads,
    owner: infra.chatAddress,
    chatTopic: infra.chatTopic,
    slotReadMs: infra.socReadTimeout ?? SLOT_READ_MS,
    feedReadMs: infra.feedReadTimeout ?? FEED_READ_MS,
    noteSlotMs: infra.noteSlotMs ?? DEFAULT_NOTE_SLOT_MS,
  });
  const writeMs = infra.gsocWriteTimeout ?? WRITE_MS;
  if (infra.via === MessageVia.OWN_STAMP) {
    if (!ownStamp) {
      throw new Error("a chat on the viewer's own stamp needs Swarm ID to stamp");
    }
    const { write, forgetRefusal } = ownStampWrite({
      stamper: ownStamp.stamper,
      url: infra.writeUrl ?? null,
      ...(ownStamp.refusal ? { refusal: ownStamp.refusal } : {}),
      gsocKey: bareHex(infra.gsocResourceId),
      gsocTopic: infra.gsocTopic,
      timeoutMs: writeMs,
      ownFeed: ownStamp.ownFeed
        ? {
            chatKey: settings.user.privateKey,
            chatTopic: infra.chatTopic,
            reads,
            readTimeoutMs: infra.feedReadTimeout ?? FEED_READ_MS,
          }
        : null,
      ...(ownStamp.onProblem ? { onProblem: ownStamp.onProblem } : {}),
      ...(ownStamp.onSent ? { onSent: ownStamp.onSent } : {}),
      ...(ownStamp.push ? { push: ownStamp.push } : {}),
    });
    return { source, write, forgetRefusal };
  }
  return {
    source,
    write: beeGsocWrite({
      url: infra.writeUrl ?? infra.beeUrl,
      gsocKey: bareHex(infra.gsocResourceId),
      gsocTopic: infra.gsocTopic,
      timeoutMs: writeMs,
      stamp: infra.stamp,
    }),
    forgetRefusal: NOTHING_REFUSED,
  };
}
