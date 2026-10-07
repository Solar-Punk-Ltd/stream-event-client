// @vitest-environment jsdom
import { createElement } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { THEMES } from '../src/design/themes';
import { StreamList } from '../src/features/catalog/StreamList/StreamList';
import {
  type Stream,
  STREAM_STATUS_LIVE,
  STREAM_STATUS_SCHEDULED,
  STREAM_STATUS_VOD,
} from '../src/features/catalog/stream';
import { button, click, input, mount, text, type, type Mounted } from './helpers/dom';

const context = vi.hoisted(() => ({ streamList: [] as Stream[] }));

vi.mock('@/app/AppProvider', async () => {
  const { gatewaySwarm } = await import('./helpers/gatewaySwarm');
  const swarm = gatewaySwarm('http://gateway.example.com');
  return { useAppContext: () => ({ streamList: context.streamList, swarm, theme: THEMES.swarm }) };
});

const NOW = Date.parse('2026-11-04T12:00:00Z');
let mounted: Mounted | null = null;

function entry(index: number, state: string, fields: Partial<Stream> = {}): Stream {
  return {
    owner: '0x' + '1'.repeat(40),
    topic: `topic-${index}`,
    title: `Stage ${index}`,
    timestamp: NOW - index * 60_000,
    mediatype: 'video',
    state,
    index,
    // An image keeps every card from fetching a frame, which this test has no gateway for.
    thumbnail: 'a'.repeat(64),
    ...fields,
  };
}

function showList(streams: Stream[]) {
  context.streamList = streams;
  mounted = mount(createElement(MemoryRouter, null, createElement(StreamList)));
}

function links(name: string): HTMLAnchorElement[] {
  return [...document.querySelectorAll('a')].filter((link) => link.textContent?.trim() === name);
}

const headings = () => [...document.querySelectorAll('h2, h3')].map((heading) => heading.textContent?.trim());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('the browse page list', () => {
  it('features the next upcoming stream with a countdown, and lists the rest under their sections', () => {
    showList([
      entry(1, STREAM_STATUS_SCHEDULED, { title: 'Next talk', scheduledStartTime: '2026-11-05T15:30:00Z' }),
      entry(2, STREAM_STATUS_SCHEDULED, { title: 'Later talk', scheduledStartTime: '2026-11-06T09:00:00Z' }),
      entry(3, STREAM_STATUS_VOD, { title: 'Old talk' }),
    ]);

    const featured = document.querySelector('.featured-stream');
    expect(featured?.textContent).toContain('Next talk');
    expect(featured?.textContent).toContain('Starts in');
    expect(featured?.textContent).toMatch(/01\s*Days\s*03\s*Hours\s*30\s*Minutes/);
    expect(headings()).toEqual(['Next talk', 'Upcoming streams', 'Later talk', 'Past streams', 'Old talk']);
    expect(links('Join stream & chat →')).toHaveLength(2);
    expect(links('Watch on Swarm →')).toHaveLength(1);
  });

  it('gives every live stream a featured block of its own under "Live now"', () => {
    showList([entry(1, STREAM_STATUS_LIVE), entry(2, STREAM_STATUS_LIVE)]);

    expect(document.querySelectorAll('.featured-stream')).toHaveLength(2);
    expect(headings().filter((heading) => heading === 'Live now')).toHaveLength(2);
  });

  it('shows the past streams eight at a time', () => {
    showList(Array.from({ length: 10 }, (_, i) => entry(i, STREAM_STATUS_VOD)));

    expect(links('Watch on Swarm →')).toHaveLength(8);
    expect(text()).toContain('1 / 2');

    click(button('Next page'));

    expect(links('Watch on Swarm →')).toHaveLength(2);
    expect(text()).toContain('2 / 2');
    expect(button('Next page').disabled).toBe(true);
  });

  it('shows the matches as one flat list while searching, without the sections', () => {
    showList([
      entry(1, STREAM_STATUS_SCHEDULED, { title: 'Swarm keynote', scheduledStartTime: '2026-11-05T15:30:00Z' }),
      entry(2, STREAM_STATUS_VOD, { title: 'Workshop', tags: ['swarm'] }),
      entry(3, STREAM_STATUS_VOD, { title: 'Unrelated' }),
    ]);

    type(input('Search streams'), 'swarm');

    expect(document.querySelector('.featured-stream')).toBeNull();
    expect(headings()).toEqual(['Swarm keynote', 'Workshop']);
  });

  it('says so when a search matches nothing', () => {
    showList([entry(1, STREAM_STATUS_VOD)]);

    type(input('Search streams'), 'devcon');

    expect(text()).toContain('No streams found matching "devcon"');
  });
});
