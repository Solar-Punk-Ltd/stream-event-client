const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** An announced broadcast's start, worded twice: how long until it, and when it is. */
interface ScheduledCountdown {
  /** "Live in 2 days", "Live in 3 hours", "Live in 1 minute", or "Starting soon" once the time has passed. */
  relative: string;
  /** The day and time it starts, in the reader's own locale and time zone. */
  absolute: string;
}

const START_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

function liveIn(count: number, unit: string): string {
  return `Live in ${count} ${unit}${count === 1 ? '' : 's'}`;
}

/**
 * The words msrs-client's scheduled placeholder writes over an announced broadcast, counted in the
 * largest whole unit left. The last minute still reads as one minute rather than none.
 */
function relativeStart(untilStartMs: number): string {
  if (untilStartMs <= 0) {
    return 'Starting soon';
  }
  const days = Math.floor(untilStartMs / DAY_MS);
  if (days > 0) {
    return liveIn(days, 'day');
  }
  const hours = Math.floor(untilStartMs / HOUR_MS);
  if (hours > 0) {
    return liveIn(hours, 'hour');
  }
  return liveIn(Math.max(1, Math.floor(untilStartMs / MINUTE_MS)), 'minute');
}

export function scheduledCountdown(startMs: number, nowMs: number): ScheduledCountdown {
  return {
    relative: relativeStart(startMs - nowMs),
    absolute: new Date(startMs).toLocaleString(undefined, START_DATE_FORMAT),
  };
}
