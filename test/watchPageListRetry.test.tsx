// @vitest-environment jsdom
import { act, createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FIRST_LOAD_RETRY_MS, WAITING_WATCH_PAGE_POLL_MS } from '../src/features/catalog/catalogPoll';
import type { CatalogRead } from '../src/features/catalog/catalogState';
import { type Rendition, type Stream, STREAM_STATUS_VOD } from '../src/features/catalog/stream';
import { StreamWatcher } from '../src/features/player/StreamWatcher/StreamWatcher';
import { mount, type Mounted } from './helpers/dom';

/**
 * The watch page while the stream list it holds has no entry for its stream, with the page's real catalog poll and
 * SWR, and only the app's list, the gateway's answers and the player faked.
 *
 * The app marks the list loaded even when its first read fails, so that a deep link still plays, and the watch page
 * then mounts the player with no entry and so with no ladder. A recording kept only by its archive has nothing to play
 * from without one.
 */

const OWNER = 'a'.repeat(40);
const TOPIC = 'archived-recording';

const rung = (name: string, index: number): Rendition => ({
  name,
  width: 1,
  height: 1,
  topic: `${TOPIC}-${name}`,
  bandwidth: 1,
  avgBandwidth: 1,
  index,
});

/** A recording the list names with its ladder, which is all the player has to play it from. */
const recording: Stream = {
  owner: OWNER,
  topic: TOPIC,
  title: 'A recording',
  mediatype: 'video',
  timestamp: 100,
  state: STREAM_STATUS_VOD,
  renditions: [rung('360p', 54), rung('480p', 54)],
};
const another: Stream = { ...recording, topic: 'another-stream', title: 'Another', renditions: undefined };

/**
 * The app's stream list, which the page shows, and the gateway the page's catalog reads ask. A read that lands hands
 * the gateway's list to the app, as the app's own `setNewStreamList` does.
 */
const app = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = {
    sourceId: '',
    /** What the app holds: empty after a first read that failed. */
    list: [] as unknown[],
    /** What the gateway answers a read with. */
    served: [] as unknown[],
    /** How many of the next reads fail. */
    failing: 0,
    readsAtMs: [] as number[],
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    show: (list: unknown[]) => {
      state.list = list;
      for (const listener of listeners) {
        listener();
      }
    },
  };
  return state;
});

vi.mock('../src/app/AppProvider', async () => {
  const { useSyncExternalStore } = await import('react');
  const { gatewaySwarm } = await import('./helpers/gatewaySwarm');
  const swarm = gatewaySwarm('/bee');
  return {
    useAppContext: () => {
      const streamList = useSyncExternalStore(app.subscribe, () => app.list);
      return {
        swarm,
        streamList,
        isStreamListLoaded: true,
        chat: null,
        readNextStreamListSlot: () => {},
        sources: [{ id: 'gateway', type: 'gateway', name: 'Event gateway', url: '/bee', offered: true }],
        parts: { player: 'gateway', 'stream-list': 'gateway', previews: 'gateway', chat: 'gateway' },
        streamListSourceId: app.sourceId,
        fetchAppState: async (): Promise<CatalogRead> => {
          app.readsAtMs.push(Date.now());
          if (app.failing > 0) {
            app.failing--;
            throw new Error('the gateway refused the read');
          }
          return { gateway: 'fake', streams: app.served, slot: null };
        },
        setNewStreamList: (read: CatalogRead) => {
          if (Array.isArray(read.streams)) {
            app.show(read.streams);
          }
        },
      };
    },
  };
});

/** The renditions handed to the player on each render, undefined for a render without a ladder. */
const players = vi.hoisted(() => ({ renditions: [] as (Rendition[] | undefined)[] }));
vi.mock('../src/features/player/SwarmHlsPlayer', () => ({
  SwarmHlsPlayer: (props: { renditions?: Rendition[] }) => {
    players.renditions.push(props.renditions);
    return createElement('video', { 'data-testid': 'player' });
  },
}));

let mounted: Mounted | null = null;

/** Opens the watch page on an app holding `list`, its catalog reads answered with `served`. */
function openWatchPage({
  list,
  served,
  failing = 0,
  sourceId,
}: {
  list: Stream[];
  served: Stream[];
  failing?: number;
  sourceId: string;
}) {
  Object.assign(app, { list, served, failing, sourceId, readsAtMs: [] });
  mounted = mount(
    createElement(
      SWRConfig,
      // A fresh cache per case, so no answer carries over from the one before.
      { value: { provider: () => new Map() } },
      createElement(
        MemoryRouter,
        { initialEntries: [`/watch/video/${OWNER}/${TOPIC}`] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: '/watch/:mediatype/:owner/:topic', element: createElement(StreamWatcher) }),
        ),
      ),
    ),
  );
}

function isPlaying(): boolean {
  return document.querySelector('[data-testid="player"]') !== null;
}

/** The rung names the player was last handed, or null when it was handed none. */
function playerLadder(): string[] | null {
  const last = players.renditions.at(-1);
  return last ? last.map((rendition) => rendition.name) : null;
}

/** Steps the fake clock until `predicate` holds, and says when it first did, or null when it never did. */
async function advanceUntil(predicate: () => boolean, limitMs: number): Promise<number | null> {
  const step = 100;
  for (let waited = 0; waited <= limitMs; waited += step) {
    if (predicate()) {
      return Date.now();
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(step);
    });
  }
  return null;
}

function gapsBetween(times: readonly number[]): number[] {
  return times.slice(1).map((atMs, i) => atMs - times[i]);
}

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 20, 12, 0, 0) });
  players.renditions.length = 0;
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('a watch page whose first stream list read failed', () => {
  it('plays at once, reads the list, and hands the player the ladder of the entry', async () => {
    openWatchPage({ list: [], served: [recording], sourceId: 'list-retry-reads' });
    expect(isPlaying(), 'the player was not mounted without an entry').toBe(true);

    const openedAt = Date.now();
    const ladderAt = await advanceUntil(() => playerLadder() !== null, 2 * WAITING_WATCH_PAGE_POLL_MS);

    expect(ladderAt, 'the page never read the list again, so the player never got its ladder').not.toBeNull();
    expect((ladderAt ?? 0) - openedAt).toBeLessThan(FIRST_LOAD_RETRY_MS);
    expect(playerLadder()).toEqual(['360p', '480p']);
  });

  it('tries a read that fails again within a few seconds, before the list has been shown', async () => {
    openWatchPage({ list: [], served: [recording], failing: 1, sourceId: 'list-retry-after-failure' });

    const ladderAt = await advanceUntil(() => playerLadder() !== null, 2 * WAITING_WATCH_PAGE_POLL_MS);

    expect(ladderAt, 'a failed read was never tried again').not.toBeNull();
    expect(app.readsAtMs.length).toBe(2);
    expect(gapsBetween(app.readsAtMs)[0]).toBeLessThanOrEqual(FIRST_LOAD_RETRY_MS);
  });

  it('reads the list no more once the entry has arrived', async () => {
    openWatchPage({ list: [], served: [recording], sourceId: 'list-retry-stops' });
    expect(await advanceUntil(() => playerLadder() !== null, 2 * WAITING_WATCH_PAGE_POLL_MS)).not.toBeNull();
    const readsBefore = app.readsAtMs.length;

    await advanceUntil(() => false, 4 * WAITING_WATCH_PAGE_POLL_MS);

    expect(app.readsAtMs.length, 'a page holding its entry kept reading the list').toBe(readsBefore);
    expect(isPlaying(), 'the player went away').toBe(true);
  });
});

describe('a watch page that holds the entry for its stream', () => {
  it('reads the list no more than the app does at load', async () => {
    openWatchPage({ list: [recording], served: [recording], sourceId: 'list-retry-listed' });

    await advanceUntil(() => false, 4 * WAITING_WATCH_PAGE_POLL_MS);

    expect(app.readsAtMs).toEqual([]);
    expect(playerLadder()).toEqual(['360p', '480p']);
  });
});

describe('a deep link to a stream the list does not have', () => {
  /**
   * Nothing here knows whether a topic the list lacks is a real stream, so the player is mounted at once. The list is
   * read again at the waiting page's pace, never faster: every read asks the slot after the newest, which is not
   * written until the list changes, and Bee skips each peer asked that early for a minute.
   */
  it('plays at once, reads the list once a minute at most, and plays the entry the list gains', async () => {
    openWatchPage({ list: [another], served: [another], sourceId: 'list-retry-deep-link' });
    expect(isPlaying(), 'the player was not mounted for a stream the list lacks').toBe(true);
    expect(playerLadder()).toBeNull();

    await advanceUntil(() => false, 3 * WAITING_WATCH_PAGE_POLL_MS);
    expect(app.readsAtMs.length, 'a page without its entry stopped reading the list').toBeGreaterThanOrEqual(2);
    for (const gap of gapsBetween(app.readsAtMs)) {
      expect(gap, 'the list was read again within a minute').toBeGreaterThanOrEqual(WAITING_WATCH_PAGE_POLL_MS);
    }

    app.served = [another, recording];
    expect(
      await advanceUntil(() => playerLadder() !== null, 1.5 * WAITING_WATCH_PAGE_POLL_MS),
      'the entry the list gained never reached the player',
    ).not.toBeNull();
    expect(playerLadder()).toEqual(['360p', '480p']);
  });
});
