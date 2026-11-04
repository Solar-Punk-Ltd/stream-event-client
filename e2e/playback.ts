/** What a video element says at one reading. */
export interface PlaybackReading {
  readonly currentTime: number;
  readonly framesDecoded: number;
}

/** Runs in the page, so it can use nothing from this module. */
export function readPlayback(element: HTMLVideoElement): PlaybackReading {
  return {
    currentTime: element.currentTime,
    framesDecoded: element.getVideoPlaybackQuality().totalVideoFrames,
  };
}

/** The longest step a position takes between two readings by playing. A longer one is a seek. */
const LONGEST_PLAYED_STEP_S = 5;

/**
 * Whether the video played between two readings: its position moved on by a playing step and more frames were decoded.
 * Neither is enough alone. A stream's timeline need not start at 0, so a player sets a position before any frame
 * arrives, and it decodes frames ahead of a position it may never leave.
 */
export function playedBetween(earlier: PlaybackReading, later: PlaybackReading): boolean {
  const step = later.currentTime - earlier.currentTime;
  return step > 0 && step <= LONGEST_PLAYED_STEP_S && later.framesDecoded > earlier.framesDecoded;
}
