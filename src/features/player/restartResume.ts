/** Where the player a restart builds starts loading, and the source that position belongs to. */
export interface RestartResume {
  readonly sourceUrl: string;
  readonly positionS: number;
  /** How long the segment holding `positionS` lasts. Playback has moved on once it passes that segment. */
  readonly segmentS: number;
}

/** The parts of a level's playlist, as hls.js holds it, that a restart reads. */
interface RestartPlaylist {
  readonly live: boolean;
  readonly targetduration: number;
  readonly fragments: ReadonlyArray<{ readonly start: number; readonly duration: number }>;
}

/** Used when a playlist gives no usable length, so a held position is always let go of eventually. */
const FALLBACK_SEGMENT_S = 1;

function segmentLengthAt(playlist: RestartPlaylist, positionS: number): number {
  const holding = playlist.fragments.find(
    (fragment) => fragment.start <= positionS && positionS < fragment.start + fragment.duration,
  );
  const lengthS = holding?.duration ?? playlist.targetduration;
  return lengthS > 0 ? lengthS : FALLBACK_SEGMENT_S;
}

/**
 * Where a restarted player picks up, read from the player that failed, or null for hls.js's own start.
 *
 * Only a finished playlist keeps the viewer's place. A recording has one timeline, so a viewer 2100 s
 * in who hit a fatal error was otherwise sent back to 0 (2026-10-15). A live rung's playlist is rebuilt
 * from its newest window on a restart, so a live viewer rejoins at the live edge as before.
 */
export function restartResumeOf(
  playlist: RestartPlaylist | undefined,
  positionS: number,
  sourceUrl: string,
): RestartResume | null {
  if (!playlist || playlist.live || !(positionS > 0)) {
    return null;
  }
  return { sourceUrl, positionS, segmentS: segmentLengthAt(playlist, positionS) };
}

/** Whether playback has left the segment a player was asked to start in. */
export function hasPlayedPast(startedAt: RestartResume, positionS: number): boolean {
  return positionS >= startedAt.positionS + startedAt.segmentS;
}

/**
 * Where the next player starts after a restart.
 *
 * @param observed What the failing player reads as its own place. Null when it holds no finished level,
 *   which is the case when it failed before its level loaded.
 * @param startedAt Where the failing player was asked to start, while playback has not yet played past it.
 * @param pending A place an earlier restart kept for a player that failed before it started loading.
 */
export function nextRestartResume(
  observed: RestartResume | null,
  startedAt: RestartResume | null,
  pending: RestartResume | null,
): RestartResume | null {
  return observed ?? startedAt ?? pending;
}
