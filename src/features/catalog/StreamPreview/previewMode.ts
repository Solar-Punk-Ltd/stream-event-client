/**
 * Where a preview card gets its picture from, decided before anything is fetched.
 *
 * Extracted from the component for the same reason `previewSource.ts` was: this package runs
 * vitest with `environment: 'node'` and no jsdom, so a rule left inside the card is a rule nothing
 * covers, and the bug this exists to prevent was entirely in the branching.
 *
 * That bug: every card took its frame by fetching the stream's manifest feed and decoding its first
 * segment. A **scheduled** entry has no manifest feed at all: it is an announcement, and the topic
 * is not written to until the broadcast starts, so the probe is a guaranteed miss that costs a slot
 * on a queue of concurrency 1 and, on a build where the miss left the loading flag set, spun
 * forever. Meanwhile the image the broadcaster actually uploaded was ignored.
 */

import { STREAM_STATUS_SCHEDULED, StreamState } from '@/features/catalog/stream';
import type { ProviderState } from '@/swarm/provider';

type PreviewMode =
  /** The catalog carries a picture. Render it and fetch nothing else. */
  | 'image'
  /** The catalog carries a picture its source will give a URL for once its node in this tab has started. */
  | 'waiting'
  /** No picture to render, so the frame has to come out of the stream's own first segment. */
  | 'probe'
  /** Nothing to render and nothing worth asking for. The default image, immediately. */
  | 'placeholder';

interface PreviewEntry {
  /** A Swarm reference, or '' / absent on an entry whose publisher gave no image. */
  thumbnail?: string;
  state?: StreamState;
  /** Set once the browser has failed to load the referenced image, so the card can move on. */
  imageFailed?: boolean;
  /** Whether the previews' source gives the picture a URL, see {@link pictureSourceOf}. */
  picture?: PictureSource;
}

/**
 * Whether the previews' source gives a picture a URL: `given`, `waiting` while a node in this tab starts
 * and will give one once ready, or `none` from a source that gives none, such as a node that failed.
 */
type PictureSource = 'given' | 'waiting' | 'none';

/**
 * ⛔ A URL the source does not give yet is not a picture that failed. A node in this tab gives none
 * until it is ready, because the browser would otherwise ask the site itself for it and fail, and a
 * card that took that failure as the picture's went on without it for as long as it stayed mounted.
 */
export function pictureSourceOf(url: string | null, sourceState: ProviderState): PictureSource {
  if (url !== null) {
    return 'given';
  }
  return sourceState === 'starting' || sourceState === 'stopped' ? 'waiting' : 'none';
}

/**
 * ⛔ The rule this exists to hold: **a scheduled stream is never probed.** Not on first render, and
 * not as the fallback when its thumbnail turns out to be unfetchable. There is no manifest behind
 * the topic in either case, so a probe there can only end as a wasted queue slot and a placeholder,
 * which is exactly what this returns without spending the fetch.
 *
 * A live or finished stream does fall back to the probe, because its manifest is real and a broken
 * thumbnail reference is no reason to lose a frame the stream can still supply.
 */
export function previewMode({ thumbnail, state, imageFailed = false, picture = 'given' }: PreviewEntry): PreviewMode {
  if (!imageFailed && picture !== 'none' && hasThumbnail(thumbnail)) {
    return picture === 'waiting' ? 'waiting' : 'image';
  }
  return state === STREAM_STATUS_SCHEDULED ? 'placeholder' : 'probe';
}

/**
 * Whether an image failure this card recorded still applies to the picture it is now being asked to
 * render.
 *
 * ⛔ A card outlives the picture it was given, which is why this compares URLs rather than reading a
 * flag. `StreamList` keys a card by topic, and in admin mode the topic belongs to the declaration and
 * outlives every session on it, so a publisher replacing an unfetchable thumbnail re-renders the same
 * mounted component with a new reference. Latched on a boolean, the first failure demoted the card for
 * as long as it stayed mounted: a live card went on probing when it had a perfectly good picture to
 * show, and a scheduled one went on showing the placeholder for ever, since {@link previewMode} never
 * probes a scheduled stream. The URL rather than the reference, because the viewer can switch where
 * Previews are read from, and a picture one source could not serve is asked of the next.
 *
 * @param failedUrl the picture's URL that failed to load, or null while none has.
 * @param url the URL this render gives the picture, or null while it has none.
 */
export function pictureFailed(failedUrl: string | null, url: string | null): boolean {
  return failedUrl !== null && failedUrl === url;
}

/** Absent and empty are the same answer: the publisher gave no image. */
function hasThumbnail(thumbnail: string | undefined): thumbnail is string {
  return typeof thumbnail === 'string' && thumbnail.trim().length > 0;
}
