import { FeedIndex, Identifier, PrivateKey, Span, Topic } from '@ethersphere/bee-js';
import { type ChatMessage, type GsocWrite, ownFeedTopic } from '@solarpunkltd/swarm-chat-js';

import { makeFeedIdentifier } from '@/shared/feedFollow';
import { postStampedSoc, type StampedSoc } from '@/swarm/providers/bee-http/stampedSocUpload';

import type { ChatReads } from '../chatParts';
import type { SwarmIdChunkToStamp, SwarmIdStampedChunk } from '../swarmId/swarmIdClient';

import { type CopyOutcome, ownFeedCopies } from './ownFeedCopies';
import { beeNodeUploadProblem, NOT_SIGNED_IN, type SendProblem, stampRefusal, weeb3PushProblem } from './stampProblems';

export type { SendProblem } from './stampProblems';

const NO_NODE = 'There is no Bee node to send it through.';

/** Sends a chunk Swarm ID signed and stamped, other than to a Bee node's URL: through the node in this browser. */
export type StampedPush = (chunk: StampedSoc) => Promise<void>;

/** What stamps a chunk with the viewer's own stamp: Swarm ID, while a viewer is signed in with it. */
export interface ChunkStamper {
  stampChunk(chunk: SwarmIdChunkToStamp): Promise<SwarmIdStampedChunk>;
}

/** The sender's own feed, where a copy of each message goes. */
interface OwnFeedOptions {
  /** The chat key, 64 hex digits, which owns the feed as it signs the messages. */
  readonly chatKey: string;
  readonly chatTopic: string;
  /** Read through for the feed's newest entry, once, to find where the next copy goes. */
  readonly reads: () => Pick<ChatReads, 'readFeedHead'>;
  readonly readTimeoutMs: number;
}

export interface OwnStampWriteOptions {
  /** Read at every write, so a viewer who signed out is seen at once. Null while nobody is signed in. */
  readonly stamper: () => ChunkStamper | null;
  /** The viewer's own Bee node, which stores a chunk under the stamp it carries, or null while there is none to use. */
  readonly url: string | null;
  /**
   * Read at every write: how a stamped chunk goes out when it does not go to {@link url}, which is through the node in
   * this browser, or null while the chat's source is not that node.
   */
  readonly push?: () => StampedPush | null;
  /**
   * Read at every write: why the page cannot send on the viewer's stamp now, such as a chat source that cannot take
   * a stamped message or a stamp that ran out, or null when it can.
   */
  readonly refusal?: () => string | null;
  /** The mined key every sender signs inbox writes with, 64 hex digits. */
  readonly gsocKey: string;
  readonly gsocTopic: string;
  readonly timeoutMs: number;
  readonly ownFeed: OwnFeedOptions;
  /** Told why a message did not go out, every time it did not. */
  readonly onProblem?: (messageId: string, problem: SendProblem) => void;
  /** Told after every message the node took, so what is shown of the stamp can be read again. */
  readonly onSent?: () => void;
  readonly fetcher?: typeof fetch;
}

interface OwnStampWrite {
  readonly write: GsocWrite;
  /** The viewer asked to send a refused message again, so the next write of it tries once more. */
  forgetRefusal(messageId: string): void;
  /** Writes the copy of a message already sent into the sender's own feed, when the viewer asks for it. */
  copy(messageId: string, payload: Uint8Array): Promise<CopyOutcome>;
}

/** A send that did not go out, carrying what the message shows. */
class SendRefusedError extends Error {
  constructor(readonly problem: SendProblem) {
    super(problem.text);
    this.name = 'SendRefusedError';
  }
}

const decoder = new TextDecoder();

function messageOf(payload: Uint8Array): ChatMessage {
  return JSON.parse(decoder.decode(payload)) as ChatMessage;
}

/** A chunk's body: its 8-byte little-endian span, then its payload. */
function withSpan(payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const span = Span.fromBigInt(BigInt(payload.length)).toUint8Array();
  const data = new Uint8Array(span.length + payload.length);
  data.set(span);
  data.set(payload, span.length);
  return data;
}

/**
 * The chat's one write for a viewer who pays with their own stamp. Swarm ID signs and stamps each chunk, and the chunk
 * goes to the viewer's own Bee node or through the node in this browser, never through the event's gateway, whatever
 * happens. The chat's inbox is one
 * single-owner chunk address, which Swarm ID stamps again in the slot it already holds, so a busy chat costs one slot.
 *
 * A refusal a resend cannot mend, such as a stamp that ran out, fails the message at once, and the chat's own resends
 * of it are refused here without asking Swarm ID again, until the viewer retries it. Once the node took the message, a
 * copy of it goes into the sender's own feed. The message never waits on that copy, and a copy that fails never fails
 * the message.
 */
export function ownStampWrite(options: OwnStampWriteOptions): OwnStampWrite {
  const { url, gsocKey, timeoutMs, ownFeed, onProblem, onSent, fetcher } = options;
  const inboxIdentifier = Identifier.fromString(options.gsocTopic).toHex();
  const refusals = new Map<string, SendProblem>();
  const copies = ownFeedCopiesOf(ownFeed, (chunk) => stampAndSend(chunk));

  async function stampAndSend(chunk: SwarmIdChunkToStamp): Promise<void> {
    const push = options.push?.() ?? null;
    if (url === null && push === null) {
      throw new SendRefusedError({ text: NO_NODE, final: true });
    }
    const stamper = options.stamper();
    if (!stamper) {
      throw new SendRefusedError({ text: NOT_SIGNED_IN, final: true });
    }
    let stamped: SwarmIdStampedChunk;
    try {
      stamped = await stamper.stampChunk(chunk);
    } catch (error) {
      throw new SendRefusedError(stampRefusal(error));
    }
    if (!stamped.owner || !stamped.signature) {
      throw new SendRefusedError(stampRefusal(null));
    }
    const stampedSoc: StampedSoc = {
      owner: stamped.owner,
      identifier: chunk.identifier,
      signature: stamped.signature,
      stamp: stamped.stamp,
      data: chunk.data,
    };
    try {
      if (push) {
        await push(stampedSoc);
      } else if (url !== null) {
        await postStampedSoc(url, stampedSoc, { timeoutMs, ...(fetcher ? { fetcher } : {}) });
      }
    } catch (error) {
      throw new SendRefusedError(push ? weeb3PushProblem(error) : beeNodeUploadProblem(error));
    }
  }

  const write: GsocWrite = async (payload) => {
    const message = messageOf(payload);
    const refusal = refusals.get(message.id);
    if (refusal) {
      throw new SendRefusedError(refusal);
    }
    try {
      const blocked = options.refusal?.() ?? (url === null && !options.push?.() ? NO_NODE : null);
      if (blocked !== null) {
        throw new SendRefusedError({ text: blocked, final: true });
      }
      await stampAndSend({
        kind: 'soc',
        identifier: inboxIdentifier,
        data: withSpan(payload),
        signer: { privateKey: gsocKey },
      });
      onSent?.();
      void copies.copyBeside(message.id, payload);
    } catch (error) {
      const problem = error instanceof SendRefusedError ? error.problem : stampRefusal(error);
      if (problem.final) {
        refusals.set(message.id, problem);
      }
      onProblem?.(message.id, problem);
      throw error instanceof SendRefusedError ? error : new SendRefusedError(problem);
    }
  };

  return {
    write,
    forgetRefusal: (messageId) => refusals.delete(messageId),
    copy: (messageId, payload) => copies.copy(messageId, payload),
  };
}

const NOT_FOUND = 'not-found';

/** The sender's own feed, `ownFeedTopic(chatTopic)` under the chat key's address, as {@link ownFeedCopies} writes it. */
function ownFeedCopiesOf(feed: OwnFeedOptions, send: (chunk: SwarmIdChunkToStamp) => Promise<void>) {
  const topic = Topic.fromString(ownFeedTopic(feed.chatTopic));
  const owner = new PrivateKey(feed.chatKey).publicKey().address().toHex();
  return ownFeedCopies({
    async nextIndex() {
      const head = await feed.reads().readFeedHead(owner, topic, { timeoutMs: feed.readTimeoutMs });
      if (head.kind === NOT_FOUND) {
        return 0;
      }
      if (head.kind !== 'content' || head.feedIndex === null) {
        throw new Error(`the own feed's newest entry answered ${head.kind}`);
      }
      return head.feedIndex + 1;
    },
    writeAt: (index, payload) =>
      send({
        kind: 'soc',
        identifier: makeFeedIdentifier(topic, FeedIndex.fromBigInt(BigInt(index))).toHex(),
        data: withSpan(payload),
        signer: { privateKey: feed.chatKey },
      }),
  });
}
