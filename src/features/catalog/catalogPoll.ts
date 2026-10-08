import type { SWRConfiguration } from 'swr';

import { WATCH_VIEW_NOT_STARTED, WATCH_VIEW_UNAVAILABLE, WatchPageView } from '@/features/catalog/watchPageView';

/**
 * How often a page that shows the catalog reads it again, in milliseconds.
 *
 * One number for every page that polls, and both read at the same pace: the browse page always, and
 * the watch page while what it shows depends on the catalog. Both use the same SWR key, so a viewer
 * moving between the two pages never has two polls running against the gateway.
 *
 * ⛔ **Once a minute, never faster.** Every read asks the list's next slot, which is not written yet,
 * and the next change to the list is written to exactly that slot. Bee skips each peer asked for an
 * address too early for a minute, and 25 to 40 early asks delayed a chat message by about 40 s, while a
 * few a minute were harmless. A browse page reading every 5 s made 12 such asks a minute per viewer. A
 * waiting watch page learns that its stream went live from the ladder's markers (see
 * `watchForLadderMarkers`), so this poll only carries a new or changed entry, a new start time or a
 * cancellation.
 */
export const CATALOG_POLL_INTERVAL_MS = 60_000;

/**
 * How often the watch page has to read the catalog again, or null when it need not.
 *
 * ⛔ **Only a message the catalog can take back needs it.** The page decides to show "This stream has
 * not started yet" from the catalog entry's `state`, and without a poll the catalog is read once, when
 * the app loads. While it waits, the ladder's markers prompt the read that takes it live, and the poll
 * carries a new start time, a title change or a cancellation. A stream that was unpublished while the
 * page waited on it is read for too: publishing it again only reaches a page that is still reading.
 * Once the player is mounted it follows the stream's own feeds, and the page deliberately keeps no
 * catalog poll for that case, see `isStreamListLoaded` in `app/AppProvider.tsx`.
 */
export function watchPageCatalogPollMs(view: WatchPageView): number | null {
  return view === WATCH_VIEW_NOT_STARTED || view === WATCH_VIEW_UNAVAILABLE ? CATALOG_POLL_INTERVAL_MS : null;
}

/**
 * SWR's error retry, flat: the next read comes `pollMs` after a failure, however many came before it.
 *
 * ⛔ **Never a backoff.** SWR skips its refresh timer while its cache holds an error and leaves the next
 * read to `onErrorRetry`, whose default waits longer after every failure, from 5 to 10 s after one up
 * to minutes after a few in a row. One slow or refused read used to hold an open page that far behind,
 * so a stream published or gone live reached it only after a reload. A retry due while the page is
 * hidden is dropped, since SWR reads again when the page is shown.
 *
 * @param pollMs The page's poll interval, or null for a page that does not poll, which retries nothing.
 */
export function retryCatalogReadAfter(pollMs: number | null): SWRConfiguration['onErrorRetry'] {
  return (_error, _key, config, revalidate, options) => {
    if (pollMs === null) {
      return;
    }
    setTimeout(() => {
      if (config.isVisible()) {
        void revalidate(options);
      }
    }, pollMs);
  };
}
