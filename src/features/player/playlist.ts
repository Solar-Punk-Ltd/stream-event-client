import { HLS_STREAM_INF } from '@/shared/hlsTags';
import { parseManifest, type Segment } from '@/shared/manifest';
import { buildMasterPlaylist, buildSwarmUri, parseSwarmUri, type Rendition } from '@/shared/masterPlaylist';

/**
 * Playlist text and feed URIs, the pure half of the Swarm HLS loader.
 *
 * Kept apart from `ManifestManagement` so it can be exercised without a Bee node, a gateway URL or
 * a browser: this is the code that decides what hls.js actually parses, and getting a tag or a URI
 * wrong here fails as a mute player rather than as an error.
 *
 * What is *not* defined here lives in src/shared instead, copied from the stream format the
 * uploader writes: the parser and the segment shape beside the HLS tags, and the master-playlist
 * builder and the swarm URI scheme. They are re-exported for the call sites that find them here.
 */

export { buildMasterPlaylist, buildSwarmUri, parseManifest, parseSwarmUri, type Segment };

/**
 * Whether a feed answered with a multivariant playlist rather than a media playlist.
 *
 * This is how a ladder is recognised, in preference to a flag on the catalog entry: it works on a
 * deep link with no catalog read behind it, and it cannot disagree with the playlist it describes.
 */
export function isMasterPlaylist(text: string): boolean {
  return text.includes(HLS_STREAM_INF);
}

/**
 * The rungs as hls.js is told about them, each live rung's average replaced by its peak.
 *
 * hls.js compares a rung's AVERAGE-BANDWIDTH with its estimate whenever two segments are buffered,
 * and its BANDWIDTH otherwise (`abr-controller.ts`, `findBestLevel`). The uploader announces a
 * rung's average from its first segment or two and corrects a live rung only when the peak drifts
 * 15% from the announced one, so a live rung whose peak sits on its encoder target keeps that first
 * figure for the whole broadcast. On 2026-11-02 a live 1080p rung was listed at 0.97 Mbps against a
 * measured 4.49, which ranked it below 720p and lifted viewers on a 3 Mbps line to it until their
 * buffer ran dry. The peak is the figure the uploader keeps correcting, and the one hls.js falls
 * back to for a rung its master gives no average, as long as `abrMaxWithRealBitrate` stays off as
 * this player leaves it. A finished rung, one with an `index`, was rewritten at the end with the
 * average over the whole recording and keeps it.
 */
export function liveAveragesAsPeaks(renditions: readonly Rendition[]): Rendition[] {
  return renditions.map((rendition) =>
    rendition.index === undefined ? { ...rendition, avgBandwidth: rendition.bandwidth } : rendition,
  );
}

/**
 * The variant feeds a master points at, in the order it lists them.
 *
 * Read off the master rather than out of the catalog, because these are the feeds hls.js will
 * actually request: polling any other set would leave the rungs it asks for un-walked while
 * keeping ones it never touches at the live edge. The owner comes from the URIs for the same
 * reason: the master is what says where its own variants live.
 */
export function masterVariants(text: string): { owner: string; topic: string }[] {
  return masterRungs(text).map(({ owner, topic }) => ({ owner, topic }));
}

/**
 * The variants a master names, each with the `BANDWIDTH` its line declares, or null where it declares
 * none. The bandwidth is what orders the rungs, so "the next lower rung" can be found.
 */
export function masterRungs(text: string): { owner: string; topic: string; bandwidth: number | null }[] {
  // The per-line trim below covers everything this call does. Kept because it bounds the loop to
  // real content, and the equivalence holds only for the line shapes the tests cover.
  const lines = text.trim().split('\n');
  const variants: { owner: string; topic: string; bandwidth: number | null }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith(HLS_STREAM_INF)) {
      continue;
    }

    const uri = lines[i + 1]?.trim();
    if (!uri || uri.startsWith('#')) {
      continue;
    }

    const variant = parseSwarmUri(uri);
    if (variant.owner && variant.topic) {
      variants.push({ ...variant, bandwidth: declaredBandwidth(line) });
    }
    i++;
  }

  return variants;
}

/** The `BANDWIDTH` attribute of an `#EXT-X-STREAM-INF` line, which `AVERAGE-BANDWIDTH` must not match. */
function declaredBandwidth(streamInf: string): number | null {
  const match = /(?:^|[:,])BANDWIDTH=(\d+)/.exec(streamInf);
  return match ? Number(match[1]) : null;
}
