import { type FragBufferedData, PlaylistLevelType } from 'hls.js';

/** The part of hls.js this uses, kept small so it can be tested without a browser. */
interface LevelErrorPlayer {
  readonly levels: readonly { fragmentError: number }[];
}

/**
 * Clears the segment error count of every level but the one that just buffered a main segment.
 *
 * hls.js clears a level's count only when that level buffers a segment, and decides every segment retry from the sum
 * of the counts over all levels (`getFragRetryOrSwitchAction` in its error controller). A level it stepped down from
 * after a segment it could not get keeps its count, since it is not played again, so after one such step every other
 * level is given fewer retries for a segment answered 404, none at two, and a longer wait before retrying a 5xx. A
 * segment that buffered says the playing level is fetching again, which is when the old counts stop meaning anything.
 *
 * `loadError` is left alone: it is what bars the level stepped down from, until `errorPenaltyExpireMs` lifts it.
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
