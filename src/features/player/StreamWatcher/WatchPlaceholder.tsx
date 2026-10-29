import {
  WATCH_VIEW_LOADING,
  WATCH_VIEW_NOT_STARTED,
  WATCH_VIEW_UNAVAILABLE,
  type WatchPageView,
} from '@/features/catalog/watchPageView';
import { Spinner } from '@/shared/components/Spinner/Spinner';

import { ScheduledPlaceholder } from './ScheduledPlaceholder';

interface WatchPlaceholderProps {
  view: WatchPageView;
  /** The announced start in epoch milliseconds, or null when the entry names none. */
  scheduledStart: number | null;
  /** A Swarm reference to the picture the publisher gave the stream. Absent or '' when there is none. */
  thumbnail?: string;
}

/**
 * What the watch page says in place of the player, and nothing once the player is showing. A shared link opens
 * before the catalog has been read, and a first read over a cold gateway takes a while.
 */
export function WatchPlaceholder({ view, scheduledStart, thumbnail }: WatchPlaceholderProps) {
  if (view === WATCH_VIEW_LOADING) {
    return (
      <WatchNotice>
        <Spinner />
        <p className="watch-notice-title">Loading this stream…</p>
      </WatchNotice>
    );
  }
  if (view === WATCH_VIEW_NOT_STARTED) {
    return <ScheduledPlaceholder scheduledStart={scheduledStart} thumbnail={thumbnail} />;
  }
  if (view === WATCH_VIEW_UNAVAILABLE) {
    return (
      <WatchNotice>
        <p className="watch-notice-title">This stream is no longer available.</p>
      </WatchNotice>
    );
  }
  return null;
}

/**
 * Under the player for a link whose stream the list does not carry once it has been read. The player still runs, because
 * a deep link may name a real stream the list has not caught up with, but a stream that was deleted or a link that was
 * mistyped would otherwise only ever say it is reconnecting.
 */
export function UnlistedStreamNote() {
  return (
    <p className="watch-unlisted" role="status">
      This stream is not in the stream list. It may have been removed, or the link may be wrong. The player keeps
      looking for it in case it starts.
    </p>
  );
}

/** The whole page for a link that does not have the shape of a watch link, such as one cut off when it was copied. */
export function NotAStreamLink() {
  return (
    <WatchNotice>
      <p className="watch-notice-title">This link does not name a stream.</p>
    </WatchNotice>
  );
}

/**
 * Stands where the player would, in the player's shape, so a viewer who followed a link to a stream
 * that is loading or gone lands on the page they expected.
 */
function WatchNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="watch-notice" role="status">
      {children}
    </div>
  );
}
