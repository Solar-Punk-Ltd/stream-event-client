/**
 * This event's own content, found through one source the way the viewer finds it, so the checks before adding a
 * source read something that is really there: the stream list, and a playlist of the stream the checks use.
 */
import { Topic } from '@ethersphere/bee-js';

import { STREAM_STATUS_LIVE, STREAM_STATUS_SCHEDULED, type Stream } from '@/features/catalog/stream';
import { isMasterPlaylist, masterVariants, parseManifest } from '@/features/player/playlist';
import { viewerCatalogSchema } from '@/shared/catalog';
import { ladderMarkerIdentifier, markerPeriodAt, parseLadderMarker } from '@/shared/ladderMarker';
import { contentText, type SwarmAnswer } from '@/swarm/answers';
import type { SwarmReader } from '@/swarm/client';
import type { ReadOptions } from '@/swarm/provider';

/** The streams a stream list's text names, or null when it is not a stream list. */
export function streamListIn(text: string): Stream[] | null {
  try {
    const parsed = viewerCatalogSchema.safeParse(JSON.parse(text));
    return parsed.success ? (parsed.data as Stream[]) : null;
  } catch {
    return null;
  }
}

/** The stream the checks read: a live one when there is one, else the newest with video. */
export function streamToTest(streams: readonly Stream[]): Stream | null {
  const withVideo = streams.filter((stream) => stream.state !== STREAM_STATUS_SCHEDULED);
  return (
    withVideo.find((stream) => stream.state === STREAM_STATUS_LIVE) ??
    [...withVideo].sort((a, b) => b.timestamp - a.timestamp)[0] ??
    null
  );
}

/** A playlist the player would read, or the answer that kept it from being read. */
type PlaylistRead =
  | { readonly kind: 'served'; readonly text: string }
  | { readonly kind: 'failed'; readonly answer: Exclude<SwarmAnswer, { kind: 'content' }> | null };

/** Where a playlist read is made, which a master it served is followed from. */
interface PlaylistPlace {
  readonly reader: Pick<SwarmReader, 'readFeedHead' | 'readFeedEntry' | 'readSoc'>;
  readonly window: ReadOptions;
  /** What to add to the viewer's clock to read the gateway's, for a ladder's time marker. */
  readonly clockOffsetMs: number;
  readonly now: () => number;
}

/**
 * How many masters naming another master are followed. A real ladder has one, and an entry that keeps naming
 * masters would otherwise keep the checks reading forever.
 */
const MAX_MASTER_DEPTH = 3;

const topicHex = (topic: string) => Topic.fromString(topic).toHex();

/**
 * The playlist the player would start from: through the ladder's time marker on a live ladder, which is how the
 * player starts there, and on any other ladder a rung's entry the stream list names. A stream the list names no
 * renditions for, a recording among them, is read by its feed head, the read the player opens it with.
 */
export async function playlistOf(place: PlaylistPlace, stream: Stream): Promise<PlaylistRead> {
  const rungs = [...(stream.renditions ?? [])].sort((a, b) => a.bandwidth - b.bandwidth);
  if (stream.state === STREAM_STATUS_LIVE && rungs.length > 0) {
    const marker = await markerOf(place, stream);
    if (marker.kind === 'failed') {
      return marker;
    }
    const rung = marker.kind === 'found' ? rungs.find(({ topic }) => topicHex(topic) in marker.rungs) : undefined;
    if (marker.kind === 'found' && rung) {
      return entryOf(place, stream, rung.topic, marker.rungs[topicHex(rung.topic)]);
    }
  }
  const lowest = rungs.find((rung) => rung.index !== undefined) ?? rungs[0];
  return lowest
    ? entryOf(place, stream, lowest.topic, lowest.index ?? 0)
    : served(
        place,
        stream,
        await place.reader.readFeedHead(stream.owner, Topic.fromString(stream.topic), place.window),
      );
}

/** The first segment a playlist names, which is a Swarm reference, or null when it names none. */
export function firstSegmentOf(text: string): string | null {
  return parseManifest(text).segments.find((segment) => !segment.gap)?.uri ?? null;
}

type MarkerRead =
  | { readonly kind: 'found'; readonly rungs: Readonly<Record<string, number>> }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed'; readonly answer: Exclude<SwarmAnswer, { kind: 'content' }> };

/** The marker of the previous period, and the one before when that is missing, as the player reads them. */
async function markerOf(place: PlaylistPlace, stream: Stream): Promise<MarkerRead> {
  const now = place.now() + place.clockOffsetMs;
  const group = Topic.fromString(stream.topic);
  for (const period of [markerPeriodAt(now) - 1, markerPeriodAt(now) - 2]) {
    const answer = await place.reader.readSoc(
      stream.owner,
      ladderMarkerIdentifier(group, period).toHex(),
      place.window,
    );
    if (answer.kind === 'content') {
      const marker = parseLadderMarker(contentText(answer), period);
      if (marker) {
        return { kind: 'found', rungs: marker.rungs };
      }
    } else if (answer.kind !== 'not-found') {
      return { kind: 'failed', answer };
    }
  }
  return { kind: 'missing' };
}

async function entryOf(
  place: PlaylistPlace,
  stream: Stream,
  topic: string,
  index: number,
  depth = 0,
): Promise<PlaylistRead> {
  return served(
    place,
    stream,
    await place.reader.readFeedEntry(stream.owner, Topic.fromString(topic), index, place.window),
    depth,
  );
}

/** A playlist read's answer as the playlist the player would play, a master followed to its first variant. */
async function served(place: PlaylistPlace, stream: Stream, answer: SwarmAnswer, depth = 0): Promise<PlaylistRead> {
  if (answer.kind !== 'content') {
    return { kind: 'failed', answer };
  }
  const text = contentText(answer);
  if (!text.startsWith('#EXTM3U')) {
    return { kind: 'failed', answer: null };
  }
  if (!isMasterPlaylist(text) || depth >= MAX_MASTER_DEPTH) {
    return { kind: 'served', text };
  }
  // An older ladder entry names its master. Its first variant is the playlist the player would play.
  const [variant] = masterVariants(text);
  return variant
    ? entryOf(place, { ...stream, owner: variant.owner || stream.owner }, variant.topic, 0, depth + 1)
    : { kind: 'served', text };
}
