import type { FeedEntry } from './chatFeed.ts';

/** One slot of a feed, or null when the slot is not written yet. */
export type SlotReader = (index: number) => Promise<Uint8Array | null>;

interface FollowOptions {
  timeoutMs: number;
  /**
   * How long to wait before asking the first unwritten slot again. Bee skips each peer asked for an address too early
   * for a minute, and 25 to 40 such asks delayed a chat message by about 40 s, so the wait keeps them to a few.
   */
  intervalMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Follows a feed from its first slot until every text in `texts` is among its verified entries, without the chat
 * server's counts of what it wrote, which only answer on the deployment's own machine. Each written slot is read once,
 * and while a text is missing only the first unwritten slot is asked again, once every `intervalMs`.
 */
export async function followFeed(
  read: SlotReader,
  decode: (payload: Uint8Array, index: number) => FeedEntry,
  texts: readonly string[],
  { timeoutMs, intervalMs, sleep = pause, now = Date.now }: FollowOptions,
): Promise<{ entries: FeedEntry[]; unwrittenAsks: number; waitedMs: number }> {
  const started = now();
  const entries: FeedEntry[] = [];
  let unwrittenAsks = 0;
  for (;;) {
    for (;;) {
      const payload = await read(entries.length);
      if (payload === null) {
        unwrittenAsks++;
        break;
      }
      entries.push(decode(payload, entries.length));
    }
    const found = new Set(entries.flatMap((entry) => (entry.ok ? [entry.text] : [])));
    const missing = texts.filter((text) => !found.has(text));
    if (!missing.length) return { entries, unwrittenAsks, waitedMs: now() - started };
    if (now() - started + intervalMs > timeoutMs) {
      throw new Error(
        `the chat feed did not hold ${missing.map((text) => `"${text}"`).join(', ')} after ${timeoutMs} ms, ` +
          `${entries.length} entries read, waited on the feed alone since the chat server's counts are not read live`,
      );
    }
    await sleep(intervalMs);
  }
}
