import type { SWRConfiguration } from 'swr';

import {
  WATCH_VIEW_NOT_STARTED,
  WATCH_VIEW_PLAYER,
  WATCH_VIEW_UNAVAILABLE,
  WatchPageView,
} from '@/features/catalog/watchPageView';

/**
 * How often a page that shows the catalog reads it again, in milliseconds.
 *
 * One number for both pages that poll: the browse page always, and the watch page while what it shows
 * depends on the catalog. Both use the same SWR key, so a viewer moving between the two pages never
 * has two polls running against the gateway.
 */
export const CATALOG_POLL_INTERVAL_MS = 5_000;

/**
 * How often the watch page has to read the catalog again, or null when it need not.
 *
 * ⛔ **Only a message the catalog can take back needs it.** The page decides to show "This stream has
 * not started yet" from the catalog entry's `state` alone, and without a poll the catalog is read once,
 * when the app loads. A viewer who opened the link before the start then stayed on that message after
 * the broadcast began, until they reloaded the page. The same holds for a stream that was unpublished
 * while the page waited on it: publishing it again only reaches a page that is still reading. Once the
 * player is mounted it follows the stream's own feeds, and the page deliberately keeps no catalog poll
 * for that case, see `isStreamListLoaded` in `app/AppProvider.tsx`.
 *
 * The one exception is a ladder the player found short. The entry turns live once the first quality
 * has reported to the admin, so a viewer who joined in the moment before the others reported holds an
 * entry naming only some of them, and the player builds its master from it once. Until the list names
 * every rung the ladder's marker does, the page reads it again, and the fuller entry rebuilds the player.
 *
 * @param ladderIncomplete What the player last said about its entry against the ladder's marker.
 */
export function watchPageCatalogPollMs(view: WatchPageView, ladderIncomplete = false): number | null {
  if (view === WATCH_VIEW_PLAYER) {
    return ladderIncomplete ? CATALOG_POLL_INTERVAL_MS : null;
  }
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
