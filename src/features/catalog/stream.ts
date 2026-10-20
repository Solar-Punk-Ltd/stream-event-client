// Defined once in src/shared, the stream list format the uploader writes, and re-exported here for
// the components.
export { type Rendition } from '@/shared/masterPlaylist';
export { MEDIA_TYPE_AUDIO, MEDIA_TYPE_VIDEO, type MediaType } from '@/shared/mediaType';
export { STREAM_STATUS_LIVE, STREAM_STATUS_SCHEDULED, STREAM_STATUS_VOD } from '@/shared/streamStatus';

import type { Rendition } from '@/shared/masterPlaylist';
import type { MediaType } from '@/shared/mediaType';

/** Known values are `StreamStatus`. Future publisher values remain valid and are treated as not-live. */
export type StreamState = string;

export interface Stream {
  owner: string;
  /**
   * The stream's primary feed. Current ladder entries name the master playlist here. Older
   * entries may name their lowest rung, with the complete ladder in `renditions`.
   */
  topic: string;
  state?: StreamState;
  duration?: string | number;
  index?: number;
  timestamp: number;
  mediatype: MediaType;
  title: string;
  /** Ladder identity, present only on streams the encoder produced more than one rendition of. */
  group?: string;
  /**
   * The ladder's rungs. On a finished entry the uploader names only the rungs that recorded, while an
   * entry the admin layer holds can still list a rung with no index. See `playableRenditions`.
   */
  renditions?: Rendition[];
  /**
   * A Swarm reference to a still image for this stream, served at `{gateway}/bzz/{thumbnail}/`.
   *
   * Optional, and empty string means the same as absent. The uploader has never written this and
   * the admin layer only started to, so the field is missing on every entry published before that
   * and on every entry a broadcaster never gave an image for. A card treats it as a hint it may
   * have, never as one it can rely on.
   */
  thumbnail?: string;
  description?: string;
  tags?: string[];
  /**
   * When an announced broadcast is meant to begin. Only the admin layer writes it, and it is
   * explicitly `null` on an entry that has no time fixed yet, which is why null is in the type.
   * Numeric epoch timestamps are accepted for publishers that mirror the adjacent `timestamp`.
   */
  scheduledStartTime?: string | number | null;
}
