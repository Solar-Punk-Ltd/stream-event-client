import { Fragment } from 'react';

import { StreamThumbnail } from '@/features/catalog/StreamCard/StreamCard';
import { scheduledStartMs } from '@/features/catalog/scheduledStart';
import { type Stream, STREAM_STATUS_LIVE } from '@/features/catalog/stream';
import { startDateTimeLabel, streamLabel } from '@/features/catalog/streamLabels';
import { WatchLink } from '@/features/catalog/WatchLink/WatchLink';

import { type Countdown, countdownTo, twoDigits } from './countdown';

import './FeaturedStream.scss';

interface FeaturedStreamProps {
  stream: Stream;
  /** The browse page's clock, which moves the countdown on. */
  now: number;
}

/**
 * The block a live stream, or the next upcoming one, gets above the cards: its badge, title and
 * description, then a countdown to its start, or a live note while it is live, beside the thumbnail
 * and the call to watch.
 */
export function FeaturedStream({ stream, now }: FeaturedStreamProps) {
  const isLive = stream.state === STREAM_STATUS_LIVE;
  const start = scheduledStartMs(stream.scheduledStartTime);
  const countdown = !isLive && start !== null ? countdownTo(start, now) : null;

  return (
    <div className="featured-stream">
      <div className="featured-stream-body">
        <span className={`featured-stream-badge${isLive ? ' live' : ''}`}>
          {streamLabel(stream.state, start !== null && start < now)}
        </span>
        {!isLive && start !== null && <p className="featured-stream-date">{startDateTimeLabel(start)}</p>}
        <h3 className="featured-stream-title">{stream.title}</h3>
        {stream.description && <p className="featured-stream-description">{stream.description}</p>}
        {countdown && <CountdownView countdown={countdown} />}
        {isLive && <p className="featured-stream-live-note">Streaming now over the Swarm network</p>}
      </div>

      <div className="featured-stream-media">
        <StreamThumbnail stream={stream} />
        <WatchLink stream={stream} />
      </div>
    </div>
  );
}

const COUNTDOWN_UNITS = [
  ['days', 'Days'],
  ['hours', 'Hours'],
  ['minutes', 'Minutes'],
] as const;

function CountdownView({ countdown }: { countdown: Countdown }) {
  if (countdown.kind === 'starting-soon') {
    return <p className="featured-stream-starts-in">Starting soon</p>;
  }

  return (
    <div className="featured-stream-countdown-wrap">
      <p className="featured-stream-starts-in">Starts in</p>
      <div className="featured-stream-countdown">
        {COUNTDOWN_UNITS.map(([unit, label], i) => (
          <Fragment key={unit}>
            {i > 0 && <div className="featured-stream-countdown-divider" />}
            <div className="featured-stream-countdown-block">
              <span className="featured-stream-countdown-number">{twoDigits(countdown[unit])}</span>
              <span className="featured-stream-countdown-label">{label}</span>
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
