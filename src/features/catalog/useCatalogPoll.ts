import { useEffect, useRef } from 'react';
import useSWR from 'swr';

import { useAppContext } from '@/app/AppProvider';
import { retryCatalogReadAfter } from '@/features/catalog/catalogPoll';

/** How the latest read of the catalog went, for a page that says so. */
interface CatalogPollState {
  error: unknown;
  isLoading: boolean;
}

/**
 * Reads the catalog again every `pollMs` and hands each answer to the app's stream list.
 *
 * Both pages that poll the catalog come through here, the browse page always and the watch page while
 * its stream has not started or was unpublished while it waited, so they share one SWR key and one
 * poll rather than running two against the gateway. The source is part of the key so that a switch
 * starts a fresh fetch rather than inheriting the previous node's answer: `isLoading` is then true
 * again while the new node is being asked, and an `error` belongs to the node now selected instead of
 * the one the viewer has left. A failed read is followed by the next at the same cadence once the list
 * has been shown from the source now selected, and within a few seconds before that, see
 * {@link retryCatalogReadAfter}.
 *
 * @param pollMs How often to read, or null not to read at all, which is SWR's null key.
 */
export function useCatalogPoll(pollMs: number | null): CatalogPollState {
  const { fetchAppState, setNewStreamList, streamListSourceId } = useAppContext();
  const listShownForSource = useRef<string | null>(null);
  const { data, error, isLoading } = useSWR(pollMs === null ? null : ['app-state', streamListSourceId], fetchAppState, {
    revalidateOnFocus: true,
    refreshInterval: pollMs ?? 0,
    dedupingInterval: pollMs ?? 0,
    shouldRetryOnError: true,
    onErrorRetry: retryCatalogReadAfter(pollMs, () => listShownForSource.current === streamListSourceId),
  });

  useEffect(() => {
    if (data) {
      listShownForSource.current = streamListSourceId;
      setNewStreamList(data);
    }
  }, [data, setNewStreamList, streamListSourceId]);

  return { error, isLoading };
}
