import { Rendition, Stream, STREAM_STATUS_VOD } from '@/features/catalog/stream';

/**
 * The rungs of a catalog entry a viewer can be handed: every rung of a live ladder, each with its peak
 * as its average, and only the rungs that have a recording once the ladder is one.
 *
 * 2026-09-23: 1080p's postage batch refused its recording, so its ladder finished without it. The
 * uploader's own catalog entry then leaves that rung out of `renditions`. The admin's entry cannot, and
 * lists it without an index, over a feed whose last playlist is a live one that will never end. The
 * recording's master already names only the rungs that recorded, so nothing plays it, and this keeps
 * the player from walking that feed for as long as the recording is watched.
 *
 * 2026-11-02: a live rung's average is what the uploader measured over its first segment or two, sent
 * again only when the rung's peak moves 15% from the one it sent, so a 1080p rung whose peak sits on
 * its encoder target listed 0.97 Mbps for a whole broadcast against a measured 4.49. hls.js prices a
 * rung by its AVERAGE-BANDWIDTH once two segments are buffered (`abr-controller.ts`, `findBestLevel`),
 * so it counted 1080p as cheaper than 720p and lifted viewers on a 3 Mbps line to it until their buffer
 * ran dry. The peak is the figure the uploader keeps correcting, and the one hls.js uses for a rung with
 * no average while `abrMaxWithRealBitrate` stays off, as the player leaves it. hls.js also gives up on a
 * slow live fragment slightly sooner with it. The stream's state decides rather than a rung's `index`,
 * because the admin keeps a finished rung's index while that rung streams again after a restart.
 */
export function playableRenditions(stream: Pick<Stream, 'state' | 'renditions'> | undefined): Rendition[] | undefined {
  const renditions = stream?.renditions;
  if (renditions === undefined) {
    return renditions;
  }
  if (stream?.state !== STREAM_STATUS_VOD) {
    return renditions.map((rendition) => ({ ...rendition, avgBandwidth: rendition.bandwidth }));
  }
  return renditions.filter((rendition) => rendition.index !== undefined);
}
