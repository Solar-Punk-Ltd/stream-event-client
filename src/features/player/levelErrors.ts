import { ErrorDetails, type FragBufferedData, PlaylistLevelType } from 'hls.js';

/** The part of hls.js this uses, kept small so it can be tested without a browser. */
interface LevelErrorPlayer {
  readonly levels: readonly { fragmentError: number; loadError: number; loadErrorTime: number }[];
}

/** The part of an hls.js error this reads. */
interface SegmentError {
  readonly details: string;
  readonly fatal: boolean;
  readonly frag?: { readonly type: PlaylistLevelType; readonly level: number };
}

/**
 * Bars the level of a main segment that failed to load from ABR's choice until `errorPenaltyExpireMs` has passed,
 * also when hls.js is going to ask for the segment again rather than give it up.
 *
 * hls.js bars a level through `loadError`, which it raises only when it gives a segment up. A failure it decides to
 * ask again raises `fragmentError` alone, and on a level it had just moved up to its ABR leaves the level when the
 * retry is due, since a segment error bars every level but the one whose segment loaded last. The level played
 * then buffers a segment, {@link clearOtherLevelsFragmentErrors} clears the count, and nothing bars the failed level
 * any more. Its playlist loaded with no segment error on record had already cleared its `loadError` too
 * (`onLevelLoaded` in the level controller). A quality whose segments all fail while its playlist moves on was chosen
 * again every 3.5 to 4 s that way, each time a playlist search, a 404 and a switch, where once a penalty is what a
 * failed quality costs.
 *
 * The level of the segment loaded last is never barred from ABR's choice, so a late segment of the level that plays is
 * still asked for again. hls.js clears the record itself once that level buffers a segment.
 *
 * @param nowMs `performance.now()`, the clock hls.js stamps `loadErrorTime` with and measures the penalty on.
 */
export function barLevelOfFailedSegment(hls: LevelErrorPlayer, data: SegmentError, nowMs: number): void {
  const frag = data.frag;
  if (data.fatal || data.details !== ErrorDetails.FRAG_LOAD_ERROR || frag?.type !== PlaylistLevelType.MAIN) {
    return;
  }
  const level = hls.levels[frag.level];
  if (level) {
    level.loadError = Math.max(level.loadError, 1);
    level.loadErrorTime = nowMs;
  }
}

/**
 * Clears the segment error count of every level but the one that just buffered a main segment.
 *
 * hls.js clears a level's count only when that level buffers a segment, and decides every segment retry from the sum
 * of the counts over all levels (`getFragRetryOrSwitchAction` in its error controller). A level it stepped down from
 * after a segment it could not get keeps its count, three after its retries, since it is not played again, so after
 * one such step every other level gets no retry for a segment answered 404 and an 8 s wait before retrying a 5xx. A
 * segment that buffered says the playing level is fetching again, which is when the old counts stop meaning anything.
 *
 * `loadError` is left alone: it is what bars the level stepped down from, or the level {@link barLevelOfFailedSegment}
 * barred, until `errorPenaltyExpireMs` lifts it.
 */
export function clearOtherLevelsFragmentErrors(hls: LevelErrorPlayer, data: Pick<FragBufferedData, 'frag'>): void {
  if (data.frag.type !== PlaylistLevelType.MAIN) {
    return;
  }
  hls.levels.forEach((level, index) => {
    if (index !== data.frag.level) {
      level.fragmentError = 0;
    }
  });
}
