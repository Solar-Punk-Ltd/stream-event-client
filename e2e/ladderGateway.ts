import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FeedIndex, Topic } from '@ethersphere/bee-js';
import type { Page, Route } from '@playwright/test';

import { makeFeedIdentifier } from '../src/shared/feedFollow';
import { buildSwarmUri } from '../src/shared/masterPlaylist';
import { GATEWAY_PATH, PREVIEW_ORIGIN, RECORDED_DIR, RecordingFile } from './recording';

/** The publisher writes a new index this often, and every segment is this long. */
const SEGMENT_MS = 2_000;
/** Segments in each published playlist, as a sliding window over the broadcast. */
const WINDOW_SEGMENTS = 5;
/** How long the broadcast has been running when the page opens, so a viewer joins mid-stream. */
const RUNNING_FOR_MS = 60_000;
/** Feed indexes whose addresses are worked out ahead, far more than any journey reaches. */
const INDEXES_PER_FEED = 1_000;
/**
 * Indexes past those that the player's search from nothing reads in its first round, every power of four less one,
 * so its reads of them are answered as misses rather than logged as unknown.
 */
const FIRST_ROUND_FAR_INDEXES = [1_023, 4_095, 16_383];

/** The fake publisher's account. Made up, so nothing it names exists on any real node. */
export const LADDER_OWNER = 'a1'.repeat(20);
const CATALOG_TOPIC = 'ladder-test-catalog';
const MASTER_TOPIC = 'ladder-test-master';

/** One quality as the stream list names it. Lowest first, which is also the order hls.js lists the levels in. */
export const RUNGS = [
  { name: '240p', width: 426, height: 240, bandwidth: 400_000, avgBandwidth: 350_000 },
  { name: '360p', width: 640, height: 360, bandwidth: 800_000, avgBandwidth: 700_000 },
  { name: '480p', width: 854, height: 480, bandwidth: 1_600_000, avgBandwidth: 1_400_000 },
  { name: '720p', width: 1280, height: 720, bandwidth: 3_000_000, avgBandwidth: 2_600_000 },
].map((rung) => ({ ...rung, topic: `ladder-test-${rung.name}` }));

export type RungName = (typeof RUNGS)[number]['name'];

/** What a request was for, which is how the journeys count them. */
export type RequestKind =
  /** A `/feeds/` head lookup of a quality. */
  | 'head'
  /** A `/soc/` read of a quality's index that was published. */
  | 'slot'
  /** A `/soc/` read of a quality's index that was not published, answered 404. */
  | 'miss'
  /** A segment of a quality. */
  | 'segment'
  /** Any read of the master feed, which a stream list that names the renditions makes unnecessary. */
  | 'master'
  /** A read of the stream list. */
  | 'catalog'
  /** Anything else, answered 404 so the journey fails on it rather than a real node being asked. */
  | 'unknown';

export interface LoggedRequest {
  readonly atMs: number;
  readonly kind: RequestKind;
  /** The quality the request was for, or null for the master, the stream list and unknown paths. */
  readonly rung: RungName | null;
  /** The feed index a head lookup answered with or a slot read asked for, where the request names one. */
  readonly index: number | null;
  readonly path: string;
}

/** Where one quality's publishing has got to. */
interface RungFeed {
  readonly name: RungName;
  readonly topic: Topic;
  /** The newest index this quality will ever publish, or null while it keeps publishing. */
  lastIndex: number | null;
  /** Whether that last index carries ENDLIST. */
  finished: boolean;
}

interface SlotAddress {
  readonly feed: 'catalog' | 'master' | RungName;
  readonly index: number;
}

interface RecordedSegment {
  readonly body: Buffer;
  readonly contentType: string;
}

/** A segment reference that says which quality and which segment it is, 64 hex digits as a real one is. */
function segmentRef(rungAt: number, sequence: number): string {
  return `${rungAt.toString(16).padStart(8, '0')}${sequence.toString(16).padStart(8, '0')}${'5e'.repeat(24)}`;
}

const SEGMENT_REF = /^([0-9a-f]{8})([0-9a-f]{8})(?:5e){24}$/;

const feedIndexHeader = (index: number) => index.toString(16).padStart(16, '0');

interface HarEntry {
  request: { url: string };
  response: { status: number; content: { mimeType: string; _file?: string; text?: string } };
}

/**
 * The recorded stream's segments in playing order, read from the recording the smoke test replays. Its playlist is
 * the one recorded body that is an HLS playlist with segments, and each segment is the body recorded for its
 * `/bytes/` read.
 */
function recordedSegments(): RecordedSegment[] {
  const har = JSON.parse(readFileSync(join(RECORDED_DIR, RecordingFile.HAR), 'utf8')) as {
    log: { entries: HarEntry[] };
  };
  const bodyOf = (entry: HarEntry): Buffer =>
    entry.response.content._file
      ? readFileSync(join(RECORDED_DIR, entry.response.content._file))
      : Buffer.from(entry.response.content.text ?? '');
  const ok = har.log.entries.filter((entry) => entry.response.status === 200);
  const playlist = ok
    .map((entry) => bodyOf(entry).toString('utf8'))
    .find((text) => text.startsWith('#EXTM3U') && text.includes('#EXTINF'));
  if (!playlist) {
    throw new Error('the recording holds no media playlist');
  }
  const refs = playlist.split('\n').filter((line) => /^[0-9a-f]{64}$/.test(line.trim()));
  return refs.map((ref) => {
    const entry = ok.find((candidate) => candidate.request.url.endsWith(`/bytes/${ref.trim()}`));
    if (!entry) {
      throw new Error(`the recording holds no body for segment ${ref}`);
    }
    return { body: bodyOf(entry), contentType: entry.response.content.mimeType };
  });
}

/**
 * A Bee gateway, inside Playwright, publishing one live stream in four qualities.
 *
 * Every quality is a sequential feed that gains an index every {@link SEGMENT_MS}, each index a playlist with a
 * sliding window of segments, a media sequence and PROGRAM-DATE-TIME stamps. The broadcast began
 * {@link RUNNING_FOR_MS} before the gateway was made, so a viewer joins it mid-stream. Segments are the recorded
 * stream's, repeated behind a discontinuity each time round. Nothing reaches a real node: a path this does not know
 * is answered 404 and logged as `unknown`.
 */
export class LadderGateway {
  readonly startedAtMs = Date.now() - RUNNING_FOR_MS;
  readonly requests: LoggedRequest[] = [];
  private readonly feeds = new Map<RungName, RungFeed>();
  private readonly byTopicHex = new Map<string, 'catalog' | 'master' | RungName>();
  private readonly bySlotId = new Map<string, SlotAddress>();
  private readonly segments = recordedSegments();

  constructor() {
    const name = (feed: 'catalog' | 'master' | RungName) =>
      feed === 'catalog' ? CATALOG_TOPIC : feed === 'master' ? MASTER_TOPIC : `ladder-test-${feed}`;
    const feeds: ('catalog' | 'master' | RungName)[] = ['catalog', 'master', ...RUNGS.map((rung) => rung.name)];
    for (const feed of feeds) {
      const topic = Topic.fromString(name(feed));
      this.byTopicHex.set(topic.toString(), feed);
      for (const index of [
        ...Array.from({ length: INDEXES_PER_FEED }, (_, index) => index),
        ...FIRST_ROUND_FAR_INDEXES,
      ]) {
        const id = makeFeedIdentifier(topic, FeedIndex.fromBigInt(BigInt(index))).toString();
        this.bySlotId.set(id, { feed, index });
      }
      if (feed !== 'catalog' && feed !== 'master') {
        this.feeds.set(feed, { name: feed, topic, lastIndex: null, finished: false });
      }
    }
  }

  /** The config.json the page is served: this gateway, this stream list, and no chat. */
  config() {
    return {
      gatewayUrl: GATEWAY_PATH,
      catalog: { owner: LADDER_OWNER, topic: CATALOG_TOPIC },
      chat: { enabled: false },
    };
  }

  /** The stream's watch page, opened directly. The app routes by the URL's hash. */
  watchPath(): string {
    return `/#/watch/video/${LADDER_OWNER}/${MASTER_TOPIC}`;
  }

  async attach(page: Page): Promise<void> {
    await page.route(`${PREVIEW_ORIGIN}${GATEWAY_PATH}/**`, (route) => this.answer(route));
  }

  /** The newest index this quality has published by now. */
  newestIndex(rung: RungName, nowMs = Date.now()): number {
    const published = Math.floor((nowMs - this.startedAtMs) / SEGMENT_MS) - 1;
    const { lastIndex } = this.feed(rung);
    return lastIndex === null ? published : Math.min(published, lastIndex);
  }

  /** The quality publishes nothing after the index it holds now, and never says it finished. */
  stop(rung: RungName): void {
    this.feed(rung).lastIndex = this.newestIndex(rung);
  }

  /** The quality stopped this long ago and has said nothing since, so its newest playlist is that old. */
  stale(rung: RungName, forMs: number): void {
    this.feed(rung).lastIndex = this.newestIndex(rung, Date.now() - forMs);
  }

  /** The quality's next index is its last, and carries ENDLIST. Already published indexes are left as they are. */
  finish(rung: RungName, agoMs = 0): void {
    const feed = this.feed(rung);
    feed.lastIndex = this.newestIndex(rung, Date.now() - agoMs) + (agoMs === 0 ? 1 : 0);
    feed.finished = true;
  }

  finishAll(): void {
    for (const rung of RUNGS) {
      this.finish(rung.name);
    }
  }

  /** How many requests of this kind were made for this quality, optionally since a moment. */
  count(kind: RequestKind, rung: RungName | null = null, sinceMs = 0): number {
    return this.requests.filter((request) => request.kind === kind && request.rung === rung && request.atMs >= sinceMs)
      .length;
  }

  /** Every request for this quality's feed, of any kind but segments, optionally since a moment. */
  feedReads(rung: RungName, sinceMs = 0): number {
    return this.requests.filter(
      (request) => request.rung === rung && request.kind !== 'segment' && request.atMs >= sinceMs,
    ).length;
  }

  /** The requests per quality and kind between two moments, for a journey to print. */
  tally(sinceMs = 0, untilMs = Infinity): Record<string, Partial<Record<RequestKind, number>>> {
    const table: Record<string, Partial<Record<RequestKind, number>>> = {};
    for (const request of this.requests) {
      if (request.atMs < sinceMs || request.atMs >= untilMs) {
        continue;
      }
      const row = (table[request.rung ?? '-'] ??= {});
      row[request.kind] = (row[request.kind] ?? 0) + 1;
    }
    return table;
  }

  unknownPaths(): string[] {
    return this.requests.filter((request) => request.kind === 'unknown').map((request) => request.path);
  }

  private feed(rung: RungName): RungFeed {
    const feed = this.feeds.get(rung);
    if (!feed) {
      throw new Error(`no quality named ${rung}`);
    }
    return feed;
  }

  private log(kind: RequestKind, rung: RungName | null, path: string, index: number | null = null): void {
    this.requests.push({ atMs: Date.now(), kind, rung, index, path });
  }

  private async answer(route: Route): Promise<void> {
    const path = new URL(route.request().url()).pathname.slice(GATEWAY_PATH.length);
    const [, resource, owner, id] = path.split('/');

    if (resource === 'bytes' && owner) {
      return this.answerSegment(route, path, owner);
    }
    if (owner === LADDER_OWNER && resource === 'feeds' && id) {
      const feed = this.byTopicHex.get(id);
      if (feed === 'catalog') {
        this.log('catalog', null, path);
        return this.fulfillFeed(route, 0, JSON.stringify([this.catalogEntry()]));
      }
      if (feed === 'master') {
        this.log('master', null, path);
        return notFound(route);
      }
      if (feed) {
        const newest = this.newestIndex(feed);
        this.log('head', feed, path, newest);
        return newest < 0 ? notFound(route) : this.fulfillFeed(route, newest, this.playlist(feed, newest));
      }
    }
    if (owner === LADDER_OWNER && resource === 'soc' && id) {
      const slot = this.bySlotId.get(id);
      if (slot?.feed === 'catalog') {
        this.log('catalog', null, path);
        return slot.index === 0 ? fulfill(route, JSON.stringify([this.catalogEntry()])) : notFound(route);
      }
      if (slot?.feed === 'master') {
        this.log('master', null, path);
        return notFound(route);
      }
      if (slot) {
        if (slot.index > this.newestIndex(slot.feed)) {
          this.log('miss', slot.feed, path, slot.index);
          return notFound(route);
        }
        this.log('slot', slot.feed, path, slot.index);
        return fulfill(route, this.playlist(slot.feed, slot.index));
      }
    }
    this.log('unknown', null, path);
    return notFound(route);
  }

  private answerSegment(route: Route, path: string, ref: string): Promise<void> {
    const match = SEGMENT_REF.exec(ref);
    const rung = match ? RUNGS[Number.parseInt(match[1], 16)] : undefined;
    if (!match || !rung) {
      this.log('unknown', null, path);
      return notFound(route);
    }
    this.log('segment', rung.name, path);
    const segment = this.segments[Number.parseInt(match[2], 16) % this.segments.length];
    return route.fulfill({ status: 200, contentType: segment.contentType, body: segment.body });
  }

  private fulfillFeed(route: Route, index: number, body: string): Promise<void> {
    return route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      headers: { 'swarm-feed-index': feedIndexHeader(index), 'swarm-feed-index-next': feedIndexHeader(index + 1) },
      body,
    });
  }

  private catalogEntry() {
    return {
      owner: LADDER_OWNER,
      topic: MASTER_TOPIC,
      title: 'Ladder test stream',
      timestamp: this.startedAtMs,
      mediatype: 'video',
      state: 'live',
      renditions: RUNGS,
    };
  }

  /**
   * The playlist one quality published at one index: the window of segments ending with segment `index`, each
   * stamped with when it began. A segment that starts the recording over follows a discontinuity, and the header
   * counts those the window has slid past.
   */
  private playlist(rung: RungName, index: number): string {
    const rungAt = RUNGS.findIndex((candidate) => candidate.name === rung);
    const first = Math.max(0, index - WINDOW_SEGMENTS + 1);
    const loop = this.segments.length;
    const startsOver = (sequence: number) => sequence > 0 && sequence % loop === 0;
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-TARGETDURATION:${SEGMENT_MS / 1000}`,
      `#EXT-X-MEDIA-SEQUENCE:${first}`,
      `#EXT-X-DISCONTINUITY-SEQUENCE:${first === 0 ? 0 : Math.floor((first - 1) / loop)}`,
    ];
    for (let sequence = first; sequence <= index; sequence++) {
      if (startsOver(sequence)) {
        lines.push('#EXT-X-DISCONTINUITY');
      }
      lines.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(this.startedAtMs + sequence * SEGMENT_MS).toISOString()}`);
      lines.push(`#EXTINF:${SEGMENT_MS / 1000}.000000,`);
      lines.push(segmentRef(rungAt, sequence));
    }
    const feed = this.feed(rung);
    if (feed.finished && feed.lastIndex === index) {
      lines.push('#EXT-X-ENDLIST');
    }
    return `${lines.join('\n')}\n`;
  }
}

function fulfill(route: Route, body: string): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/octet-stream', body });
}

function notFound(route: Route): Promise<void> {
  return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found","code":404}' });
}

/** The URI hls.js knows a quality's level by, as the master the player builds names it. */
export function rungUri(rung: RungName): string {
  return buildSwarmUri(LADDER_OWNER, `ladder-test-${rung}`);
}
