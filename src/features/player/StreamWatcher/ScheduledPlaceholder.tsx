import { useCallback, useEffect, useState } from 'react';

import { useAppContext } from '@/app/AppProvider';
import { useNodeState } from '@/shared/nodeInTabStatus';

import { scheduledCountdown } from './scheduledCountdown';

import './ScheduledPlaceholder.scss';

/** Often enough that "Live in 1 minute" never stands for long after it stops being true. */
const COUNTDOWN_TICK_MS = 30_000;

function useNow(tickMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, [tickMs]);

  return now;
}

interface ScheduledPlaceholderProps {
  /** The announced start in epoch milliseconds, or null when the entry names none. */
  scheduledStart: number | null;
  /** A Swarm reference to the picture the publisher gave the broadcast. Absent or '' when there is none. */
  thumbnail?: string;
}

/**
 * Stands where the player will be for a broadcast that is announced but not live: its picture, and
 * how long until it starts, as the Swarm site shows it.
 */
export function ScheduledPlaceholder({ scheduledStart, thumbnail }: ScheduledPlaceholderProps) {
  const now = useNow(COUNTDOWN_TICK_MS);
  const { swarm } = useAppContext();
  // Read again while it shows, because a node in this tab gives the picture its URL only once it is
  // ready, and nothing else renders the placeholder again when it becomes so.
  useNodeState(useCallback(() => swarm.statusOf('previews').state, [swarm]));
  const thumbnailUrl =
    thumbnail !== undefined && thumbnail.trim() !== '' ? swarm.reader('previews').urlFor(thumbnail, 'thumbnail') : null;
  // The URL and not a boolean, so a picture the publisher replaces, or another source's, is tried again.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const picture = thumbnailUrl !== null && thumbnailUrl !== failedUrl ? thumbnailUrl : null;
  const countdown = scheduledStart === null ? null : scheduledCountdown(scheduledStart, now);

  return (
    <div className="scheduled-placeholder" role="status">
      {picture && (
        <>
          <img className="scheduled-placeholder-backdrop" src={picture} alt="" aria-hidden="true" />
          <img
            key={picture}
            className="scheduled-placeholder-image"
            src={picture}
            alt=""
            onError={() => setFailedUrl(picture)}
          />
        </>
      )}
      <div className="scheduled-placeholder-overlay">
        {countdown ? (
          <>
            <span className="scheduled-placeholder-relative">{countdown.relative}</span>
            <span className="scheduled-placeholder-absolute">{countdown.absolute}</span>
          </>
        ) : (
          <span className="scheduled-placeholder-relative">This stream has not started yet.</span>
        )}
      </div>
    </div>
  );
}
