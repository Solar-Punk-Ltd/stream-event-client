/** Where a viewer was in a recording, and whether they had paused it. */
interface PlaybackPlace {
  readonly positionS: number;
  readonly paused: boolean;
}

/** One stream's place, as the player playing it records it and the player that replaces it reads it. */
export interface StreamPlace {
  /** The place the last player recorded, or null when none has. */
  recorded(): PlaybackPlace | null;
  record(place: PlaybackPlace): void;
}

/**
 * The place a viewer had in a recording, carried from the player the watch page takes down to the one it puts up
 * when the viewer moves the video to another source. weeb-3's player and the app's are different components, so a
 * move to or from weeb-3 builds a new player, which started the recording again (measured 2026-10-18 on rc.4). A
 * player records its place as it is taken down and the next one starts there, so the place never comes from the
 * page of a player that is gone.
 *
 * A place at the very start is not recorded, so a player taken down before it got anywhere, as React's development
 * mode does with every effect, leaves the place the viewer had.
 */
export class PlacesAcrossSwap {
  private readonly places = new Map<string, StreamPlace>();

  /** The same object for one stream for as long as this lives, so a player can hold it. */
  forStream(streamKey: string): StreamPlace {
    const known = this.places.get(streamKey);
    if (known) {
      return known;
    }
    let place: PlaybackPlace | null = null;
    const stream: StreamPlace = {
      recorded: () => place,
      record: (next) => {
        if (next.positionS > 0) {
          place = next;
        }
      },
    };
    this.places.set(streamKey, stream);
    return stream;
  }
}

/** A video's place as a player follows it, read as the player is taken down. */
interface FollowedPlace {
  place(): PlaybackPlace;
  detach(): void;
}

/**
 * Follows a video's place for as long as it stays on the page.
 *
 * A browser pauses a video taken off the page, by itself and possibly before the player hears it is taken down, so
 * `paused` is read from the plays and pauses the video had while it was on the page, never from the video once it
 * has left.
 */
export function followPlace(media: HTMLMediaElement): FollowedPlace {
  let pausedOnPage = media.paused;
  const onPlayOrPause = (): void => {
    if (media.isConnected) {
      pausedOnPage = media.paused;
    }
  };
  media.addEventListener('play', onPlayOrPause);
  media.addEventListener('pause', onPlayOrPause);
  return {
    place: () => ({ positionS: media.currentTime, paused: media.isConnected ? media.paused : pausedOnPage }),
    detach: () => {
      media.removeEventListener('play', onPlayOrPause);
      media.removeEventListener('pause', onPlayOrPause);
    },
  };
}

/**
 * How long a duration short of the place may stay the same before the recording counts as having stopped growing.
 * Three times the 9 s weeb-3 took to grow from its first duration to the whole length in the one measurement there is,
 * so the measured growth is waited out and a recording that ends before the place is not held for ever.
 */
export const DURATION_SETTLED_MS = 30_000;

/** How far before the end a place past it is taken, so the video starts on a frame rather than on the end. */
const SHORT_OF_END_S = 1;

/**
 * Moves a video to `place` once its duration reaches it, holding it still until then, and plays it from there unless
 * the viewer had paused. Calls `onArrived` once it is there. Answers a detach that stops waiting.
 *
 * Used for weeb-3's player, whose `attachStream` starts only at the beginning or live. Its player is hls.js, which
 * loads from wherever the video is moved to. weeb-3 rebuilds a recording's playlist from its first segments on, so
 * the duration it first names is a few seconds and a seek past it lands at its end. Measured on 2026-10-18 on a
 * 1483 s recording: 8 s at its metadata, the whole length about 9 s later. Every play until then, weeb-3's own
 * included, is paused again, so the start of the recording does not play first.
 *
 * A duration that stays short of the place for {@link DURATION_SETTLED_MS} is taken as the whole recording, and the
 * video goes a second before its end instead, never back to the start.
 */
export function moveToPlace(media: HTMLMediaElement, place: PlaybackPlace, onArrived: () => void): () => void {
  let settled: ReturnType<typeof setTimeout> | null = null;
  const hold = (): void => media.pause();
  const arriveAt = (positionS: number): void => {
    detach();
    media.currentTime = positionS;
    if (!place.paused) {
      media.play().catch(() => undefined);
    }
    onArrived();
  };
  const goNearEnd = (): void => {
    settled = null;
    arriveAt(Math.max(0, media.duration - SHORT_OF_END_S));
  };
  const move = (): void => {
    if (!(media.duration > 0)) {
      return;
    }
    if (media.duration >= place.positionS) {
      arriveAt(place.positionS);
      return;
    }
    if (settled !== null) {
      clearTimeout(settled);
    }
    settled = setTimeout(goNearEnd, DURATION_SETTLED_MS);
  };
  const detach = (): void => {
    if (settled !== null) {
      clearTimeout(settled);
      settled = null;
    }
    media.removeEventListener('play', hold);
    media.removeEventListener('loadedmetadata', move);
    media.removeEventListener('durationchange', move);
  };
  media.autoplay = false;
  media.pause();
  media.addEventListener('play', hold);
  media.addEventListener('loadedmetadata', move);
  media.addEventListener('durationchange', move);
  if (media.readyState >= HTMLMediaElement.HAVE_METADATA) {
    move();
  }
  return detach;
}
