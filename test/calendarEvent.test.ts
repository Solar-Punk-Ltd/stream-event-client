import { describe, expect, it } from 'vitest';

import {
  calendarEvent,
  googleCalendarUrl,
  icsFile,
  icsFileName,
  office365Url,
  outlookComUrl,
  yahooCalendarUrl,
} from '../src/features/catalog/AddToCalendar/calendarEvent';

const START = Date.parse('2026-11-26T16:00:00Z');
const WATCH = 'https://viewer.example.com/#/watch/video/0xabc/topic-1';
const stream = {
  owner: '0xabc',
  topic: 'topic-1',
  title: 'Swarm Community Call — November 2026',
  description: 'Monthly community call.\n- Core Development Updates',
};
const event = calendarEvent(stream, START, WATCH, [{ label: 'Watch on X', href: 'https://x.com/i/broadcasts/abc' }]);

describe('a stream as a calendar entry', () => {
  it('runs an hour from the start, at the stream page, and names every place to watch', () => {
    expect(event.endMs - event.startMs).toBe(3_600_000);
    expect(event.location).toBe(WATCH);
    expect(event.description).toBe(
      'Monthly community call.\n- Core Development Updates\n\n' +
        `Watch on Swarm: ${WATCH}\nWatch on X: https://x.com/i/broadcasts/abc`,
    );
  });

  it('has no blank lead when the stream has no description', () => {
    expect(calendarEvent({ ...stream, description: undefined }, START, WATCH, []).description).toBe(
      `Watch on Swarm: ${WATCH}`,
    );
  });

  it('gives Google the title, both times and the place', () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe(stream.title);
    expect(url.searchParams.get('dates')).toBe('20261126T160000Z/20261126T170000Z');
    expect(url.searchParams.get('details')).toBe(event.description);
    expect(url.searchParams.get('location')).toBe(WATCH);
  });

  it('gives both Outlooks the same entry on their own hosts', () => {
    for (const [make, host] of [
      [outlookComUrl, 'outlook.live.com'],
      [office365Url, 'outlook.office.com'],
    ] as const) {
      const url = new URL(make(event));
      expect(url.host).toBe(host);
      expect(url.pathname).toBe('/calendar/0/deeplink/compose');
      expect(url.searchParams.get('subject')).toBe(stream.title);
      expect(url.searchParams.get('startdt')).toBe('2026-11-26T16:00:00Z');
      expect(url.searchParams.get('enddt')).toBe('2026-11-26T17:00:00Z');
    }
  });

  it('gives Yahoo the entry in its own field names', () => {
    const url = new URL(yahooCalendarUrl(event));
    expect(url.searchParams.get('v')).toBe('60');
    expect(url.searchParams.get('st')).toBe('20261126T160000Z');
    expect(url.searchParams.get('et')).toBe('20261126T170000Z');
    expect(url.searchParams.get('in_loc')).toBe(WATCH);
  });
});

describe('the iCalendar file', () => {
  const file = icsFile(event, Date.parse('2026-11-12T09:00:00Z'));
  const unfolded = file.replace(/\r\n /g, '');

  it('is one event with its times in UTC', () => {
    expect(file.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(file.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(unfolded).toContain('UID:topic-1@0xabc\r\n');
    expect(unfolded).toContain('DTSTAMP:20261112T090000Z\r\n');
    expect(unfolded).toContain('DTSTART:20261126T160000Z\r\n');
    expect(unfolded).toContain('DTEND:20261126T170000Z\r\n');
    expect(unfolded).toContain('SUMMARY:Swarm Community Call — November 2026\r\n');
  });

  it('escapes line breaks, commas and semicolons in its text', () => {
    const text = icsFile({ ...event, description: 'One, two; three\nfour \\ five' }, 0).replace(/\r\n /g, '');
    expect(text).toContain('DESCRIPTION:One\\, two\\; three\\nfour \\\\ five\r\n');
  });

  it('keeps every line within 75 octets', () => {
    const encoder = new TextEncoder();
    for (const line of file.split('\r\n')) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it('is named after the stream', () => {
    expect(icsFileName(stream.title)).toBe('swarm-community-call-november-2026.ics');
    expect(icsFileName('—')).toBe('stream.ics');
  });
});
