import { scheduledStartMs } from '@/features/catalog/scheduledStart';
import { type Stream, STREAM_STATUS_LIVE, STREAM_STATUS_SCHEDULED, type StreamState } from '@/features/catalog/stream';

/**
 * The words a stream's card and featured block carry, as msrs-client writes them. A state this has
 * never heard of reads as a recording, the same way `streamGroups` files it with the finished streams.
 * An upcoming stream whose start has passed says so, because the publisher has not started it yet and
 * "Upcoming" on a date in the past reads as wrong.
 */
export function streamLabel(
  state: StreamState | undefined,
  startPassed = false,
): 'Live' | 'Upcoming' | 'Start time passed' | 'Recording' {
  if (state === STREAM_STATUS_LIVE) {
    return 'Live';
  }
  if (state === STREAM_STATUS_SCHEDULED) {
    return startPassed ? 'Start time passed' : 'Upcoming';
  }
  return 'Recording';
}

export function callToAction(state: StreamState | undefined): string {
  return state === STREAM_STATUS_LIVE || state === STREAM_STATUS_SCHEDULED
    ? 'Join stream & chat →'
    : 'Watch on Swarm →';
}

/** Left unset in the app, so a viewer reads dates in their own language and time zone. Set by tests. */
export interface DateFormat {
  locale?: string;
  timeZone?: string;
}

const DATE: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' };
const DATE_AND_TIME: Intl.DateTimeFormatOptions = { ...DATE, hour: '2-digit', minute: '2-digit' };

function formatted(ms: number, options: Intl.DateTimeFormatOptions, { locale, timeZone }: DateFormat): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(ms);
}

export function startDateTimeLabel(startMs: number, format: DateFormat = {}): string {
  return formatted(startMs, DATE_AND_TIME, format);
}

/**
 * The date in a card's corner: the start and its time for an upcoming stream, and for any other the
 * day it was held, which is its scheduled start when it had one and its publication otherwise.
 *
 * An upcoming stream with no start fixed gets no date. msrs-client shows the day it was announced
 * there, which reads as its start.
 */
export function cardDateLabel(
  stream: Pick<Stream, 'state' | 'timestamp' | 'scheduledStartTime'>,
  format: DateFormat = {},
): string | null {
  const start = scheduledStartMs(stream.scheduledStartTime);
  if (stream.state === STREAM_STATUS_SCHEDULED) {
    return start === null ? null : startDateTimeLabel(start, format);
  }
  return formatted(start ?? stream.timestamp, DATE, format);
}
