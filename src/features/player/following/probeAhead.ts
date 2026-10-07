import type { FeedEntry, FeedReader } from './feedReader';

/**
 * How far past a refused slot to look, in order, the distances today's player uses. Of the
 * seventy-four refused slots measured with something behind them on 2026-08-06, seventy-three had it
 * at +1.
 */
export const PROBE_DISTANCES: readonly number[] = [1, 2, 4, 8];

/**
 * When a follower looks past the slot it is waiting on.
 *
 * `polls` is today's rule: after that many unanswered asks in a row, below a ceiling. `time` looks
 * once, when the slot is that late past the moment it was expected to appear, so the trigger does not
 * depend on how often the follower happens to ask.
 */
export type RefusedSlotTrigger =
  | { readonly kind: 'polls'; readonly polls: number; readonly ceiling: number }
  | { readonly kind: 'time'; readonly lateMs: number }
  | { readonly kind: 'never' };

/** Today's trigger: after three unserved polls, and not past thirty. */
export const TODAY_TRIGGER: RefusedSlotTrigger = { kind: 'polls', polls: 3, ceiling: 30 };

export function pollsTriggerFires(trigger: RefusedSlotTrigger, unservedPolls: number): boolean {
  return trigger.kind === 'polls' && unservedPolls >= trigger.polls && unservedPolls < trigger.ceiling;
}

/**
 * Read past `missing` at each distance in turn and return the first entry that answers. Sequential
 * on purpose: the common case is +1, and stopping there costs one read.
 */
export async function probeAhead(
  reader: FeedReader,
  missing: number,
  distances: readonly number[] = PROBE_DISTANCES,
): Promise<FeedEntry | null> {
  for (const distance of distances) {
    const read = await reader.read(missing + distance);
    if (read.found) {
      return read.entry;
    }
  }
  return null;
}
