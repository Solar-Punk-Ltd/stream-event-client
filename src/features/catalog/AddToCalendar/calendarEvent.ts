import type { StreamLink } from '@/features/catalog/streamLinks';

/** How long a calendar entry runs. The catalog names a start and no end. */
const CALENDAR_EVENT_MINUTES = 60;

interface CalendarEvent {
  /** Names the entry to a calendar, so adding it twice gives one entry. */
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  description: string;
  /** Where the broadcast is watched: the stream's page on this site. */
  location: string;
}

/** What a calendar is told about a stream: its words, then where it can be watched. */
export function calendarEvent(
  stream: { owner: string; topic: string; title: string; description?: string },
  startMs: number,
  watchUrl: string,
  links: StreamLink[],
): CalendarEvent {
  const places = [`Watch on Swarm: ${watchUrl}`, ...links.map(({ label, href }) => `${label}: ${href}`)];
  const words = (stream.description ?? '').trim();
  return {
    id: `${stream.topic}@${stream.owner}`,
    title: stream.title,
    startMs,
    endMs: startMs + CALENDAR_EVENT_MINUTES * 60_000,
    description: [words, places.join('\n')].filter(Boolean).join('\n\n'),
    location: watchUrl,
  };
}

/** `20261126T160000Z`, the form iCalendar, Google and Yahoo take. */
function compactUtc(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** `2026-11-26T16:00:00Z`, the form Outlook takes. */
function isoUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function withQuery(base: string, fields: Record<string, string>): string {
  return `${base}?${new URLSearchParams(fields).toString()}`;
}

export function googleCalendarUrl(event: CalendarEvent): string {
  return withQuery('https://calendar.google.com/calendar/render', {
    action: 'TEMPLATE',
    text: event.title,
    dates: `${compactUtc(event.startMs)}/${compactUtc(event.endMs)}`,
    details: event.description,
    location: event.location,
  });
}

function outlookUrl(host: string, event: CalendarEvent): string {
  return withQuery(`https://${host}/calendar/0/deeplink/compose`, {
    subject: event.title,
    startdt: isoUtc(event.startMs),
    enddt: isoUtc(event.endMs),
    body: event.description,
    location: event.location,
  });
}

export function outlookComUrl(event: CalendarEvent): string {
  return outlookUrl('outlook.live.com', event);
}

export function office365Url(event: CalendarEvent): string {
  return outlookUrl('outlook.office.com', event);
}

export function yahooCalendarUrl(event: CalendarEvent): string {
  return withQuery('https://calendar.yahoo.com/', {
    v: '60',
    title: event.title,
    st: compactUtc(event.startMs),
    et: compactUtc(event.endMs),
    desc: event.description,
    in_loc: event.location,
  });
}

function icsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

const ICS_LINE_OCTETS = 75;

/** A content line broken as iCalendar asks: at most 75 octets a line, each continuation led by a space. */
function folded(line: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = '';
  let octets = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (octets + size > ICS_LINE_OCTETS) {
      lines.push(current);
      current = ' ';
      octets = 1;
    }
    current += character;
    octets += size;
  }
  lines.push(current);
  return lines.join('\r\n');
}

/** The event as an iCalendar file, for Apple Calendar and any other that opens one. */
export function icsFile(event: CalendarEvent, nowMs: number): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//stream-event-client//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${icsText(event.id)}`,
    `DTSTAMP:${compactUtc(nowMs)}`,
    `DTSTART:${compactUtc(event.startMs)}`,
    `DTEND:${compactUtc(event.endMs)}`,
    `SUMMARY:${icsText(event.title)}`,
    `DESCRIPTION:${icsText(event.description)}`,
    `LOCATION:${icsText(event.location)}`,
    `URL:${event.location}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .map(folded)
    .join('\r\n')
    .concat('\r\n');
}

/** A file name from the title: its letters and digits in lower case, joined by hyphens. */
export function icsFileName(title: string): string {
  const name = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${name || 'stream'}.ics`;
}
