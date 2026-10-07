// @vitest-environment jsdom
import { createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Stream } from '../src/features/catalog/stream';
import { StreamWatcher } from '../src/features/player/StreamWatcher/StreamWatcher';
import { mount, type Mounted } from './helpers/dom';

const OWNER = 'a'.repeat(40);
const TOPIC = 'stream-one';
const DAY = 24 * 60 * 60 * 1000;

const appContext = vi.hoisted(() => ({
  value: { streamList: [] as unknown[], isStreamListLoaded: true, chat: null },
}));

vi.mock('../src/app/AppProvider', async () => {
  const { gatewaySwarm } = await import('./helpers/gatewaySwarm');
  const swarm = gatewaySwarm('/bee');
  return { useAppContext: () => ({ ...appContext.value, swarm }) };
});
vi.mock('../src/features/catalog/useCatalogPoll', () => ({ useCatalogPoll: () => {} }));
vi.mock('../src/features/player/SwarmHlsPlayer', () => ({
  SwarmHlsPlayer: () => createElement('video', { 'data-testid': 'player' }),
}));

let mounted: Mounted | null = null;

function openWatchPage(entry: Partial<Stream> & Record<string, unknown>) {
  appContext.value = {
    ...appContext.value,
    streamList: [{ owner: OWNER, topic: TOPIC, title: 'A talk', timestamp: 1, mediatype: 'video', ...entry }],
  };
  mounted = mount(
    createElement(
      MemoryRouter,
      { initialEntries: [`/watch/video/${OWNER}/${TOPIC}`] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: '/watch/:mediatype/:owner/:topic', element: createElement(StreamWatcher) }),
      ),
    ),
  );
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
});

describe('the watch page', () => {
  it('leads back to the streams with a plain back link', () => {
    openWatchPage({ state: 'vod' });
    const back = document.querySelector('a.watch-back');

    expect(back?.textContent).toBe('← Back');
    expect(back?.getAttribute('href')).toBe('/');
  });

  it('titles the stream and puts its description under the title', () => {
    openWatchPage({ state: 'live', title: 'Opening talk', description: 'Day one.\nThe main hall.' });

    expect(document.querySelector('h1')?.textContent).toBe('Opening talk');
    expect(document.querySelector('.watch-info-description')?.textContent).toBe('Day one.\nThe main hall.');
  });

  it('writes no state above the title, as the Swarm site does not', () => {
    openWatchPage({ state: 'live' });

    expect(document.querySelector('.watch-info')?.textContent).toBe('A talk');
  });

  it('shows no description when the entry carries none, or carries something that is not text', () => {
    openWatchPage({ state: 'vod', description: { html: '<b>no</b>' } as unknown as string });

    expect(document.querySelector('.watch-info-description')).toBeNull();
  });

  it('counts down to an announced stream over its picture', () => {
    openWatchPage({
      state: 'scheduled',
      scheduledStartTime: new Date(Date.now() + 3 * DAY + 60_000).toISOString(),
      thumbnail: 'abc',
    });

    expect(document.body.textContent).toContain('Live in 3 days');
    expect(document.querySelector('.scheduled-placeholder img')?.getAttribute('src')).toBe('/bee/bzz/abc/');
  });
});
