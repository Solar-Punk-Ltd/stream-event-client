// @vitest-environment jsdom
import { act, createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Stream } from '../src/features/catalog/stream';
import { StreamWatcher } from '../src/features/player/StreamWatcher/StreamWatcher';
import { mount, type Mounted } from './helpers/dom';

const OWNER = 'a'.repeat(40);
const TOPIC = 'stream-one';
const DAY = 24 * 60 * 60 * 1000;

const appContext = vi.hoisted(() => ({
  value: {
    streamList: [] as unknown[],
    isStreamListLoaded: true,
    chat: null,
    readNextStreamListSlot: () => {},
  } as Record<string, unknown>,
}));

vi.mock('../src/app/AppProvider', async () => {
  const { gatewaySwarm } = await import('./helpers/gatewaySwarm');
  const swarm = gatewaySwarm('/bee');
  return { useAppContext: () => ({ swarm, ...appContext.value }) };
});
const seen = vi.hoisted(() => ({
  pollMs: [] as (number | null)[],
  player: null as null | { renditions?: { name: string }[]; onLadderShort?: () => void },
}));
vi.mock('../src/features/catalog/useCatalogPoll', () => ({
  useCatalogPoll: (pollMs: number | null) => {
    seen.pollMs.push(pollMs);
  },
}));
vi.mock('../src/features/player/SwarmHlsPlayer', () => ({
  SwarmHlsPlayer: (props: NonNullable<typeof seen.player>) => {
    seen.player = props;
    return createElement('video', { 'data-testid': 'player' });
  },
}));

let mounted: Mounted | null = null;

function watchPage() {
  return createElement(
    MemoryRouter,
    { initialEntries: [`/watch/video/${OWNER}/${TOPIC}`] },
    createElement(
      Routes,
      null,
      createElement(Route, { path: '/watch/:mediatype/:owner/:topic', element: createElement(StreamWatcher) }),
    ),
  );
}

function listing(entry: Partial<Stream> & Record<string, unknown>) {
  appContext.value = {
    ...appContext.value,
    streamList: [{ owner: OWNER, topic: TOPIC, title: 'A talk', timestamp: 1, mediatype: 'video', ...entry }],
  };
}

function openWatchPage(entry: Partial<Stream> & Record<string, unknown>) {
  listing(entry);
  mounted = mount(watchPage());
}

afterEach(() => {
  delete appContext.value.swarm;
  seen.pollMs.length = 0;
  seen.player = null;
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

  /**
   * Architecture review 2026-10-08, P2 #7. The entry turns live once the first quality has reported,
   * and a viewer who joined then is handed one rendition. When the player says a ladder marker names a
   * rung the entry lacks, the page reads the list's next slot once, and the fuller entry reaches the
   * player. It never polls for it: a slot asked before it is written stays hidden for a minute.
   */
  it('reads the stream list once each time the player says its entry is short, and never polls for it', () => {
    const rung = (name: string) => ({
      name,
      width: 1,
      height: 1,
      topic: `rung-${name}`,
      bandwidth: 1,
      avgBandwidth: 1,
    });
    const readNextStreamListSlot = vi.fn();
    appContext.value = { ...appContext.value, readNextStreamListSlot };
    openWatchPage({ state: 'live', renditions: [rung('360p')] });

    act(() => seen.player?.onLadderShort?.());

    expect(readNextStreamListSlot).toHaveBeenCalledTimes(1);
    expect(seen.pollMs.every((pollMs) => pollMs === null)).toBe(true);

    listing({ state: 'live', renditions: ['360p', '480p', '720p', '1080p'].map(rung) });
    mounted?.render(watchPage());
    expect(seen.player?.renditions?.map((r) => r.name)).toEqual(['360p', '480p', '720p', '1080p']);
    expect(seen.pollMs.every((pollMs) => pollMs === null)).toBe(true);
  });

  describe('with a video source that brings its own player', () => {
    function withOwnPlayer() {
      const attached: { from: string; topic: string }[] = [];
      appContext.value = {
        ...appContext.value,
        swarm: {
          ownPlayer: (feature: string) =>
            feature === 'player'
              ? {
                  id: 'added-1',
                  status: () => ({ state: 'starting', peers: 2 }),
                  load: async () => ({
                    attach: async (_video: HTMLVideoElement, _owner: string, topic: string, from: string) =>
                      void attached.push({ topic, from }),
                  }),
                }
              : null,
          reader: () => ({ urlFor: () => null }),
        },
      };
      return attached;
    }

    it("plays through that player instead of the app's, live from the newest entry", async () => {
      const attached = withOwnPlayer();
      openWatchPage({ state: 'live' });
      await act(async () => {});

      expect(seen.player).toBeNull();
      expect(document.querySelector('.own-player video')).not.toBeNull();
      expect(attached).toEqual([{ topic: TOPIC, from: 'live' }]);
      expect(document.querySelector('[role="status"]')?.textContent).toBe('Connecting, 2 peers');
    });

    it('plays a finished stream from its beginning', async () => {
      const attached = withOwnPlayer();
      openWatchPage({ state: 'vod' });
      await act(async () => {});

      expect(attached).toEqual([{ topic: TOPIC, from: 'beginning' }]);
    });
  });
});
