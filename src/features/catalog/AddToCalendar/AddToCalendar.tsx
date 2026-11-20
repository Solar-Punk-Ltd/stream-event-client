import { useEffect, useId, useRef, useState } from 'react';

import { scheduledStartMs } from '@/features/catalog/scheduledStart';
import { type Stream, STREAM_STATUS_SCHEDULED } from '@/features/catalog/stream';
import { shownLinks } from '@/features/catalog/streamLinks';
import { watchPath } from '@/features/catalog/watchPath';

import {
  calendarEvent,
  googleCalendarUrl,
  icsFile,
  icsFileName,
  office365Url,
  outlookComUrl,
  yahooCalendarUrl,
} from './calendarEvent';

import './AddToCalendar.scss';

/** The stream's page as an address someone can open from a calendar. The app routes by hash. */
function watchUrl(stream: Pick<Stream, 'mediatype' | 'owner' | 'topic'>): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${watchPath(stream)}`;
}

/**
 * Puts an announced stream in the viewer's calendar: a button that opens the calendars to pick from.
 * Shown only while the stream is still to come and names its start, since a calendar entry for a
 * stream that is live or over helps nobody. Everything is made in the page from the catalog entry.
 */
export function AddToCalendar({ stream, now }: { stream: Stream; now: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  const start = scheduledStartMs(stream.scheduledStartTime);
  if (stream.state !== STREAM_STATUS_SCHEDULED || start === null || start <= now) {
    return null;
  }

  const event = calendarEvent(stream, start, watchUrl(stream), shownLinks(stream.links));
  const calendars = [
    { name: 'Google Calendar', href: googleCalendarUrl(event) },
    { name: 'Outlook.com', href: outlookComUrl(event) },
    { name: 'Office 365', href: office365Url(event) },
    { name: 'Yahoo Calendar', href: yahooCalendarUrl(event) },
  ];

  return (
    <div className="add-to-calendar" ref={wrapRef}>
      <button
        type="button"
        className="add-to-calendar-button"
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={() => setIsOpen((open) => !open)}
      >
        Add to Calendar <span aria-hidden="true">{isOpen ? '▴' : '▾'}</span>
      </button>
      {isOpen && (
        <ul className="add-to-calendar-menu" id={menuId}>
          {calendars.map(({ name, href }) => (
            <li key={name}>
              <a href={href} target="_blank" rel="noreferrer" onClick={() => setIsOpen(false)}>
                {name}
              </a>
            </li>
          ))}
          <li>
            <a
              href={`data:text/calendar;charset=utf-8,${encodeURIComponent(icsFile(event, now))}`}
              download={icsFileName(stream.title)}
              onClick={() => setIsOpen(false)}
            >
              Apple / iCal (.ics)
            </a>
          </li>
        </ul>
      )}
    </div>
  );
}
