import { HLS_STREAM_INF } from '@/shared/hlsTags';
import { parseManifest, type Segment } from '@/shared/manifest';
import { buildMasterPlaylist, buildSwarmUri, parseSwarmUri } from '@/shared/masterPlaylist';

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
  // ⚠️ The per-line trim below covers everything this one does, so dropping this call is an
  // equivalent mutant that survives `pnpm mutate`. Kept rather than removed because it bounds the
  // loop to real content, and the equivalence holds only for the line shapes the tests cover.
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
