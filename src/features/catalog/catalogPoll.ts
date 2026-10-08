import { WATCH_VIEW_NOT_STARTED, WATCH_VIEW_UNAVAILABLE, WatchPageView } from '@/features/catalog/watchPageView';

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
 * not started yet" from the catalog entry's `state`, and without a poll the catalog is read once, when
 * the app loads. The broadcast's first ladder marker takes the page live sooner than the list's next
 * slot can (see `watchForLiveMarker`), but a new start time, a title change or a cancellation reaches
 * the page only through the catalog. The same holds for a stream that was unpublished
 * while the page waited on it: publishing it again only reaches a page that is still reading. Once the
 * player is mounted it follows the stream's own feeds, and the page deliberately keeps no catalog poll
 * for that case, see `isStreamListLoaded` in `app/AppProvider.tsx`.
 */
export function watchPageCatalogPollMs(view: WatchPageView): number | null {
  return view === WATCH_VIEW_NOT_STARTED || view === WATCH_VIEW_UNAVAILABLE ? CATALOG_POLL_INTERVAL_MS : null;
}
