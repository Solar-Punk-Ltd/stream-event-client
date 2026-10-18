// @vitest-environment jsdom
/**
 * The watch page of an announced stream shows the publisher's picture behind the countdown. With
 * Previews on Weeb3 the node gives that picture its URL only once it is ready, so the page has to draw
 * it then, rather than keep the blank it had while the node started.
 */
import { act, createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StreamWatcher } from '../src/features/player/StreamWatcher/StreamWatcher';
import { SwarmClient } from '../src/swarm/client';
import { BeeHttpProvider } from '../src/swarm/providers/bee-http/beeHttpProvider';
import { Weeb3Provider, type Weeb3RuntimeView } from '../src/swarm/providers/weeb-3/weeb3Provider';
import type { Weeb3Node } from '../src/swarm/providers/weeb-3/weeb3Package';
import type { Weeb3Status } from '../src/swarm/providers/weeb-3/weeb3Runtime';
import { mount, type Mounted } from './helpers/dom';

const OWNER = 'a'.repeat(40);
const TOPIC = 'stream-one';
const THUMBNAIL = 'ab'.repeat(32);
const DAY = 24 * 60 * 60 * 1000;

const appContext = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock('../src/app/AppProvider', () => ({ useAppContext: () => appContext.value }));
vi.mock('../src/features/catalog/useCatalogPoll', () => ({ useCatalogPoll: () => undefined }));

let status: Weeb3Status = { state: 'starting', peers: 0 };
const runtime: Weeb3RuntimeView = {
  status: () => status,
  acquire: async () => ({}) as Weeb3Node,
  release: () => undefined,
  whenReady: () => new Promise<Weeb3Node>(() => undefined),
  restart: () => undefined,
};

let mounted: Mounted | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  status = { state: 'starting', peers: 0 };
  appContext.value = {
    swarm: new SwarmClient({
      chosen: { id: 'gateway', provider: new BeeHttpProvider({ baseUrl: '/bee' }) },
      routes: {
        previews: { id: 'added-1', provider: new Weeb3Provider({ runtime, pageOrigin: 'http://viewer.example' }) },
      },
    }),
    streamList: [
      {
        owner: OWNER,
        topic: TOPIC,
        title: 'A talk',
        timestamp: 1,
        mediatype: 'video',
        state: 'scheduled',
        scheduledStartTime: new Date(Date.now() + 3 * DAY).toISOString(),
        thumbnail: THUMBNAIL,
      },
    ],
    isStreamListLoaded: true,
    chat: null,
    readNextStreamListSlot: () => {},
    sources: [{ id: 'gateway', type: 'gateway', name: 'Event gateway', url: '/bee', offered: true }],
    parts: { player: 'gateway', 'stream-list': 'gateway', previews: 'added-1', chat: 'gateway' },
  };
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const poster = () => document.querySelector('.scheduled-placeholder-image')?.getAttribute('src') ?? null;

describe("an announced stream's picture with Previews on Weeb3", () => {
  it('is drawn once the node is ready, having asked nothing of the site while it started', async () => {
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
    expect(document.body.textContent).toContain('Live in 3 days');
    expect(poster()).toBeNull();

    status = { state: 'ready', peers: 3 };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(poster()).toBe(`/weeb-3/bzz/${THUMBNAIL}/`);
  });
});
