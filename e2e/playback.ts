/** What a video element says at one reading. */
export interface PlaybackReading {
  readonly currentTime: number;
  readonly readyState: number;
  readonly framesDecoded: number;
}

/** Runs in the page, so it can use nothing from this module. */
export function readPlayback(element: HTMLVideoElement): PlaybackReading {
  return {
    currentTime: element.currentTime,
    readyState: element.readyState,
    framesDecoded: element.getVideoPlaybackQuality().totalVideoFrames,
  };
}

/** Whether the video played between two readings. */
export function playedBetween(_earlier: PlaybackReading, later: PlaybackReading): boolean {
  return later.readyState >= 3 || later.currentTime > 0;
}
