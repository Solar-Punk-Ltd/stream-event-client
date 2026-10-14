import { FeedIndex, Identifier, Span, Topic } from '@ethersphere/bee-js';
import {
  createChatMessage,
  encodeChatMessage,
  MessageType,
  MessageVia,
  ownFeedTopic,
  parseChatMessage,
} from '@solarpunkltd/swarm-chat-js';
import { describe, expect, it } from 'vitest';

import { type ChatReads } from '../../src/features/chat/chatParts';
import {
  OWN_FEED_UNREADABLE,
  ownStampWrite,
  type OwnStampWriteOptions,
  type SendProblem,
} from '../../src/features/chat/stamp/ownStampWrite';
import { NOT_SIGNED_IN, STAMP_RAN_OUT } from '../../src/features/chat/stamp/stampProblems';
import type { SwarmIdChunkToStamp, SwarmIdStampedChunk } from '../../src/features/chat/swarmId/swarmIdClient';
import { makeFeedIdentifier } from '../../src/shared/feedFollow';
import type { SwarmAnswer } from '../../src/swarm/answers';
import { addressOf, GUEST_KEY, idOf } from '../helpers/signedChat';

const NODE = 'http://localhost:1633';
const GSOC_KEY = 'd4'.repeat(32);
const GSOC_TOPIC = 'the-inbox';
const CHAT_TOPIC = 'chat-a-stream';
const STAMP = 'ee'.repeat(113);
const SIGNATURE = 'ab'.repeat(65);

function payloadOf(label: string, own = false): Uint8Array {
  const { bytes } = createChatMessage(GUEST_KEY, {
    id: idOf(label),
    topic: CHAT_TOPIC,
    type: MessageType.TEXT,
    text: `the text of ${label}`,
    name: 'Ada',
    ts: 1_000,
    via: MessageVia.OWN_STAMP,
    own,
  });
  return bytes;
}

const hexOf = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

class FakeStamper {
  readonly asked: SwarmIdChunkToStamp[] = [];
  refusal: unknown = null;

  async stampChunk(chunk: SwarmIdChunkToStamp): Promise<SwarmIdStampedChunk> {
    this.asked.push(chunk);
    if (this.refusal) {
      throw this.refusal;
    }
    return { address: 'f'.repeat(64), stamp: STAMP, owner: addressOf(chunk.signer.privateKey), signature: SIGNATURE };
  }
}

interface Posted {
  url: string;
  body: Uint8Array;
  stamp: string | null;
}

function node(answer: () => Response = () => new Response('{}', { status: 201 })) {
  const posted: Posted[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    posted.push({
      url: String(input),
      body: init?.body as Uint8Array,
      stamp: new Headers(init?.headers).get('swarm-postage-stamp'),
    });
    return answer();
  };
  return { posted, fetcher };
}

function headReads(answer: SwarmAnswer): { reads: () => ChatReads; asked: string[] } {
  const asked: string[] = [];
  const reader = {
    readFeedHead: async (owner: string, topic: Topic) => {
      asked.push(`${owner}/${topic.toHex()}`);
      return answer;
    },
  } as unknown as ChatReads;
  return { reads: () => reader, asked };
}

const NOT_FOUND: SwarmAnswer = { kind: 'not-found', serverTimeMs: null };

function setUp(extra: Partial<OwnStampWriteOptions> = {}) {
  const stamper = new FakeStamper();
  const bee = node();
  const problems: Array<{ id: string; problem: SendProblem }> = [];
  const options: OwnStampWriteOptions = {
    stamper: () => stamper,
    url: NODE,
    gsocKey: GSOC_KEY,
    gsocTopic: GSOC_TOPIC,
    timeoutMs: 1_000,
    ownFeed: null,
    onProblem: (id, problem) => problems.push({ id, problem }),
    fetcher: bee.fetcher,
    ...extra,
  };
  return { stamper, bee, problems, writer: ownStampWrite(options) };
}

const inboxIdentifier = Identifier.fromString(GSOC_TOPIC).toHex();
const withSpan = (payload: Uint8Array) =>
  Uint8Array.from([...Span.fromBigInt(BigInt(payload.length)).toUint8Array(), ...payload]);

describe("a chat message sent on the viewer's own stamp", () => {
  it("has Swarm ID sign and stamp the inbox chunk, and goes to the viewer's Bee node under that stamp", async () => {
    const { stamper, bee, writer } = setUp();
    const payload = payloadOf('first');
    await writer.write(payload);

    expect(stamper.asked).toEqual([
      { kind: 'soc', identifier: inboxIdentifier, data: withSpan(payload), signer: { privateKey: GSOC_KEY } },
    ]);
    const owner = addressOf(GSOC_KEY);
    expect(bee.posted).toEqual([
      { url: `${NODE}/soc/${owner}/${inboxIdentifier}?sig=${SIGNATURE}`, body: withSpan(payload), stamp: STAMP },
    ]);
  });

  it('is refused with the reason when Swarm ID will not stamp it, and is not tried again until asked', async () => {
    const { stamper, bee, problems, writer } = setUp();
    stamper.refusal = Object.assign(new Error('expired'), { code: 'upload-unavailable', reason: 'stamp-expired' });
    const payload = payloadOf('refused');

    await expect(writer.write(payload)).rejects.toThrow(STAMP_RAN_OUT);
    expect(problems).toEqual([{ id: idOf('refused'), problem: { text: STAMP_RAN_OUT, final: true } }]);

    await expect(writer.write(payload)).rejects.toThrow(STAMP_RAN_OUT);
    expect(stamper.asked, 'a resend of a refused message never reaches Swarm ID').toHaveLength(1);
    expect(bee.posted, 'nothing is sent anywhere else').toEqual([]);

    stamper.refusal = null;
    writer.forgetRefusal(idOf('refused'));
    await writer.write(payload);
    expect(stamper.asked).toHaveLength(2);
    expect(bee.posted).toHaveLength(1);
  });

  it('is refused when nobody is signed in with Swarm ID any more', async () => {
    const { problems, writer, bee } = setUp({ stamper: () => null });
    await expect(writer.write(payloadOf('signed-out'))).rejects.toThrow(NOT_SIGNED_IN);
    expect(problems[0].problem).toEqual({ text: NOT_SIGNED_IN, final: true });
    expect(bee.posted).toEqual([]);
  });

  it("is refused at once when the viewer's node refuses it, and resent by the chat when the node did not answer", async () => {
    const refusing = setUp({
      fetcher: node(() => new Response('{"message":"batch not usable"}', { status: 422 })).fetcher,
    });
    await expect(refusing.writer.write(payloadOf('node-says-no'))).rejects.toThrow();
    expect(refusing.problems[0].problem).toEqual({
      text: 'Your Bee node refused it (HTTP 422: batch not usable).',
      final: true,
    });

    const failing = setUp({ fetcher: node(() => new Response('', { status: 503 })).fetcher });
    await expect(failing.writer.write(payloadOf('node-is-busy'))).rejects.toThrow();
    expect(failing.problems[0].problem).toEqual({
      text: 'Your Bee node answered with an error (HTTP 503).',
      final: false,
    });
    await expect(failing.writer.write(payloadOf('node-is-busy'))).rejects.toThrow();
    expect(failing.stamper.asked, 'a failure a resend can mend is tried again').toHaveLength(2);
  });

  it('is refused with the reason the page gives when it cannot send on the stamp now, and reaches nobody', async () => {
    const { stamper, bee, problems, writer } = setUp({ url: null, refusal: () => 'The event gateway stamps.' });
    await expect(writer.write(payloadOf('blocked'))).rejects.toThrow('The event gateway stamps.');
    expect(problems[0].problem).toEqual({ text: 'The event gateway stamps.', final: true });
    expect(stamper.asked).toEqual([]);
    expect(bee.posted).toEqual([]);
  });

  it('is sent as it was signed while the own feed is off', async () => {
    const { bee, writer } = setUp();
    const payload = payloadOf('as-signed');
    await writer.write(payload);
    expect(bee.posted[0].body).toEqual(withSpan(payload));
  });
});

describe("a copy in the sender's own feed", () => {
  const ownTopic = Topic.fromString(ownFeedTopic(CHAT_TOPIC));
  const slot = (index: number) => makeFeedIdentifier(ownTopic, FeedIndex.fromBigInt(BigInt(index))).toHex();

  it('is written first, at the next place of the own feed, signed by the chat key, and the message says own', async () => {
    const head = headReads(NOT_FOUND);
    const { stamper, bee, writer } = setUp({
      ownFeed: { chatKey: GUEST_KEY, chatTopic: CHAT_TOPIC, reads: head.reads, readTimeoutMs: 1_000 },
    });
    await writer.write(payloadOf('one'));
    await writer.write(payloadOf('two'));

    expect(head.asked, 'the own feed is looked up once').toEqual([`${addressOf(GUEST_KEY)}/${ownTopic.toHex()}`]);
    expect(stamper.asked.map(({ identifier, signer }) => [identifier, signer.privateKey])).toEqual([
      [slot(0), GUEST_KEY],
      [inboxIdentifier, GSOC_KEY],
      [slot(1), GUEST_KEY],
      [inboxIdentifier, GSOC_KEY],
    ]);

    const copy = bee.posted[0].body.subarray(8);
    const sent = bee.posted[1].body.subarray(8);
    expect(hexOf(copy), 'the copy is the message exactly as it is sent').toBe(hexOf(sent));
    const check = parseChatMessage(sent, { origin: 'https://example.com' });
    expect(check.ok && check.message).toMatchObject({ id: idOf('one'), own: true, via: MessageVia.OWN_STAMP });
    expect(hexOf(sent)).toBe(hexOf(encodeChatMessage(check.ok ? check.message : ({} as never))));
  });

  it('continues after the newest entry the feed already holds', async () => {
    const head = headReads({ kind: 'content', bytes: new Uint8Array([1]), feedIndex: 41, serverTimeMs: null });
    const { stamper, writer } = setUp({
      ownFeed: { chatKey: GUEST_KEY, chatTopic: CHAT_TOPIC, reads: head.reads, readTimeoutMs: 1_000 },
    });
    await writer.write(payloadOf('later'));
    expect(stamper.asked[0].identifier).toBe(slot(42));
  });

  it('is written once for a message the chat sends again', async () => {
    const head = headReads(NOT_FOUND);
    const { stamper, writer } = setUp({
      ownFeed: { chatKey: GUEST_KEY, chatTopic: CHAT_TOPIC, reads: head.reads, readTimeoutMs: 1_000 },
    });
    await writer.write(payloadOf('again'));
    await writer.write(payloadOf('again'));
    expect(stamper.asked.map(({ identifier }) => identifier)).toEqual([slot(0), inboxIdentifier, inboxIdentifier]);
  });

  it('holds the message back when the own feed cannot be read, so no message claims a copy it does not have', async () => {
    const head = headReads({ kind: 'unavailable', cause: { kind: 'timeout', timeoutMs: 1_000 } });
    const { stamper, bee, problems, writer } = setUp({
      ownFeed: { chatKey: GUEST_KEY, chatTopic: CHAT_TOPIC, reads: head.reads, readTimeoutMs: 1_000 },
    });
    await expect(writer.write(payloadOf('no-feed'))).rejects.toThrow(OWN_FEED_UNREADABLE);
    expect(problems[0].problem).toEqual({ text: OWN_FEED_UNREADABLE, final: false });
    expect(stamper.asked).toEqual([]);
    expect(bee.posted).toEqual([]);
  });
});
