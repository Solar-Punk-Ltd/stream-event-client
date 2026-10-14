import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Bee, PrivateKey, Topic } from '@ethersphere/bee-js';
import {
  createChatMessage,
  MESSAGE_VERSION,
  MessageType,
  MessageVia,
  parseFeedEntry,
  parseHistoryFile,
  verifyChatMessage,
  type ChatMessage,
} from '@solarpunkltd/swarm-chat-js';

import { viewerCatalogSchema } from '../../src/shared/catalog';
import { CATALOG_STATE_VOD } from '../../src/shared/contracts/catalogState';
import { MEDIA_TYPE_VIDEO } from '../../src/shared/contracts/mediaType';
import { parseManifest } from '../../src/shared/manifest';
import {
  PREVIEW_ORIGIN,
  RECORDING_INBOX_KEY,
  RECORDING_INBOX_TOPIC,
  recordingConfig,
  type Published,
} from '../recording';
import { accountOf, signChatBinding } from './chatBinding';

/**
 * Publishes one finished stream and its chat onto a fresh node, in the formats the viewer reads, and checks each
 * against the viewer's or the chat library's own parser before it is written, so a recording is never made of data
 * the app would refuse.
 *
 * The chat's feed entries and history file are written here, not by the chat aggregator. The aggregator's own live
 * test bed covers the real writer against real nodes. This covers what the viewer reads.
 */
const STREAM_TOPIC = 'recorded-finished-stream';
const CATALOG_TOPIC = 'recorded-catalog';
const STREAM_TITLE = 'Recorded test pattern';
const STREAM_SECONDS = 6;
const SEGMENT_SECONDS = 2;
const CHAT_NAMES = ['ada', 'grace', 'alan'];
const CHAT_TEXTS = ['first message', 'second message', 'third message', 'fourth message', 'the newest message'];
/** Which of the messages above a Swarm ID account signs for, and which is sent with the sender's own stamp. */
const SWARM_ID_MESSAGE = 1;
const OWN_STAMP_MESSAGE = 2;

/** A few seconds of test pattern and tone as the event ships it: MPEG-TS segments of H.264 and AAC, and a VOD playlist. */
function encodeStream(): { playlist: string; segments: Map<string, Uint8Array> } {
  const dir = mkdtempSync(join(tmpdir(), 'viewer-record-stream-'));
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `testsrc=size=320x180:rate=25:duration=${STREAM_SECONDS}`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${STREAM_SECONDS}`,
      '-c:v',
      'libx264',
      '-profile:v',
      'baseline',
      '-pix_fmt',
      'yuv420p',
      '-g',
      String(25 * SEGMENT_SECONDS),
      '-keyint_min',
      String(25 * SEGMENT_SECONDS),
      '-sc_threshold',
      '0',
      '-c:a',
      'aac',
      '-b:a',
      '64k',
      '-f',
      'hls',
      '-hls_time',
      String(SEGMENT_SECONDS),
      '-hls_playlist_type',
      'vod',
      '-hls_segment_filename',
      join(dir, 'segment%d.ts'),
      join(dir, 'playlist.m3u8'),
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  const segments = new Map(
    readdirSync(dir)
      .filter((name: string) => name.endsWith('.ts'))
      .map((name) => [name, new Uint8Array(readFileSync(join(dir, name)))]),
  );
  return { playlist: readFileSync(join(dir, 'playlist.m3u8'), 'utf8'), segments };
}

function check<T>(what: string, result: { ok: true; value: T } | { ok: false; reason: string; detail: string }): T {
  if (!result.ok) throw new Error(`${what} would be refused by the chat library: ${result.reason}, ${result.detail}`);
  return result.value;
}

export async function publish(beeUrl: string, stamp: string, beeVersion: string) {
  const bee = new Bee(beeUrl);
  const deferred = { deferred: true };
  const streamKey = new PrivateKey(randomBytes(32));
  const chatKey = new PrivateKey(randomBytes(32));
  const owner = streamKey.publicKey().address().toHex();

  const { playlist, segments } = encodeStream();
  const references = new Map<string, string>();
  for (const [name, bytes] of segments) {
    references.set(name, (await bee.data.upload(stamp, bytes, deferred)).reference.toHex());
  }
  // The viewer resolves a bare reference against its gateway, so each segment line becomes its reference.
  const published = playlist
    .split('\n')
    .map((line) => references.get(line.trim()) ?? line)
    .join('\n');
  const manifest = parseManifest(published);
  if (!manifest.isFinalized || manifest.segments.length !== segments.size) {
    throw new Error(
      `the viewer reads the playlist as ${manifest.segments.length} segments, finished ${manifest.isFinalized}`,
    );
  }
  await bee.feed
    .makeWriter(Topic.fromString(STREAM_TOPIC), streamKey)
    .uploadPayload(stamp, published, { ...deferred, index: 0 });

  const catalog = viewerCatalogSchema.parse([
    {
      owner,
      topic: STREAM_TOPIC,
      title: STREAM_TITLE,
      timestamp: Date.now(),
      mediatype: MEDIA_TYPE_VIDEO,
      state: CATALOG_STATE_VOD,
      duration: STREAM_SECONDS,
      index: 0,
    },
  ]);
  await bee.feed
    .makeWriter(Topic.fromString(CATALOG_TOPIC), streamKey)
    .uploadPayload(stamp, JSON.stringify(catalog), { ...deferred, index: 0 });

  // Every message but the newest goes into one history file, and the newest is the feed's head entry linking to it,
  // so opening the chat reads the head, the history file, and then the slots after it.
  const chatTopic = `chat-${STREAM_TOPIC}`;
  const now = Date.now();
  const swarmIdAccount = randomBytes(32);
  const messages: ChatMessage[] = CHAT_TEXTS.map((text, seq) => {
    const author = new PrivateKey(randomBytes(32));
    const ts = now - (CHAT_TEXTS.length - seq) * 60_000;
    const binding =
      seq === SWARM_ID_MESSAGE
        ? signChatBinding(swarmIdAccount, PREVIEW_ORIGIN, author.publicKey().address().toHex(), new Date(ts))
        : undefined;
    const message = createChatMessage(author, {
      topic: chatTopic,
      type: MessageType.TEXT,
      text,
      name: CHAT_NAMES[seq % CHAT_NAMES.length],
      ts,
      via: seq === OWN_STAMP_MESSAGE ? MessageVia.OWN_STAMP : MessageVia.GATEWAY,
      ...(binding ? { idb: binding } : {}),
    }).message;
    const verdict = verifyChatMessage(message, { origin: PREVIEW_ORIGIN, allowLocalHttp: true });
    if (!verdict.ok || (verdict.identity !== null) !== (binding !== undefined)) {
      throw new Error(`message ${seq} would not pass the viewer's check: ${JSON.stringify(verdict)}`);
    }
    return message;
  });
  const rows = messages.map((msg, seq) => ({ seq, at: msg.ts + 500, msg }));
  const head = rows.length - 1;
  const history = {
    v: MESSAGE_VERSION,
    topic: chatTopic,
    fromSeq: 0,
    toSeq: head - 1,
    messages: rows.slice(0, head),
    prev: null,
  };
  const historyBytes = new TextEncoder().encode(JSON.stringify(history));
  const historyRef = (await bee.data.upload(stamp, historyBytes, deferred)).reference.toHex();
  const link = { ref: historyRef, toSeq: head - 1 };
  check('the history file', parseHistoryFile(historyBytes, chatTopic, link));

  const chatWriter = bee.feed.makeWriter(Topic.fromString(chatTopic), chatKey);
  for (const [seq, row] of rows.entries()) {
    const entry = new TextEncoder().encode(
      JSON.stringify({ v: MESSAGE_VERSION, ...row, history: seq === head ? link : null }),
    );
    check(`feed entry ${seq}`, parseFeedEntry(entry, seq, chatTopic));
    await chatWriter.uploadPayload(stamp, entry, { ...deferred, index: seq });
  }

  const config = recordingConfig(
    { owner, topic: CATALOG_TOPIC },
    {
      gsocResourceId: RECORDING_INBOX_KEY,
      gsocTopic: RECORDING_INBOX_TOPIC,
      feedOwner: chatKey.publicKey().address().toHex(),
    },
  );
  const record: Published = {
    stream: { owner, topic: STREAM_TOPIC, title: STREAM_TITLE, segments: segments.size },
    chat: {
      topic: chatTopic,
      texts: CHAT_TEXTS,
      names: messages.map((message) => message.name),
      swarmId: { text: CHAT_TEXTS[SWARM_ID_MESSAGE], account: accountOf(swarmIdAccount) },
      ownStamp: { text: CHAT_TEXTS[OWN_STAMP_MESSAGE] },
    },
    bee: { version: beeVersion },
  };
  return { config, published: record };
}
