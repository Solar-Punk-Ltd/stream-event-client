// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StreamBrowser } from '../src/features/catalog/StreamBrowser/StreamBrowser';
import { mount, type Mounted } from './helpers/dom';

/**
 * Bee skips each peer it asked for an address not written yet, for a minute. Every read of the stream
 * list asks the list's next slot, which is not written until something changes, so each read is one
 * such early ask, and a page asking more than once a minute keeps its node's peers skipped for the slot
 * the next change lands in.
 */
const SKIP_MS = 60_000;

const app = vi.hoisted(() => ({
  sourceId: '',
  readsAtMs: [] as number[],
  /** Whether the read about to be made fails, given how many came before it. */
  fails: (_readsBefore: number) => false,
}));

vi.mock('../src/app/AppProvider', () => ({
  useAppContext: () => ({
    streamList: [],
    isStreamListFromCurrentGateway: true,
    theme: { heroTitle: 'Streams', heroSubtitle: '', footer: {} },
    streamListSourceId: app.sourceId,
    fetchAppState: async () => {
      const readsBefore = app.readsAtMs.length;
      app.readsAtMs.push(Date.now());
      if (app.fails(readsBefore)) {
        throw new Error('the gateway refused the read');
      }
      return { gateway: 'fake', streams: null, slot: null };
    },
    setNewStreamList: () => undefined,
  }),
}));
vi.mock('../src/app/layout/Footer/Footer', () => ({ Footer: () => null }));
vi.mock('../src/features/catalog/StreamList/StreamList', () => ({ StreamList: () => null }));

let mounted: Mounted | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

/** Opens the browse page and leaves it open for `ms`. Each case gets its own SWR key so no answer carries over. */
async function openBrowsePageFor(ms: number, sourceId: string): Promise<number[]> {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 9, 12, 0, 0) });
  Object.assign(app, { sourceId, readsAtMs: [] });
  mounted = mount(createElement(StreamBrowser));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  return [...app.readsAtMs];
}

function gapsBetween(times: readonly number[]): number[] {
  return times.slice(1).map((atMs, i) => atMs - times[i]);
}

describe('the browse page reading the stream list', () => {
  it('keeps reading it, and asks the unwritten next slot at most once a minute', async () => {
    app.fails = () => false;
    const reads = await openBrowsePageFor(4 * SKIP_MS, 'browse-poll-answered');

    expect(reads.length, 'an open page stopped reading the list').toBeGreaterThan(1);
    for (const gap of gapsBetween(reads)) {
      expect(gap, 'the list was asked more than once a minute').toBeGreaterThanOrEqual(SKIP_MS);
    }
  });

  /**
   * A viewer whose first read fails would otherwise look at an empty page for a minute. A retry asks
   * the same unwritten slot again, so the quick ones are kept to the first load.
   */
  it('retries a failed first read within a few seconds, until the list has been shown once', async () => {
    app.fails = (readsBefore) => readsBefore < 2;
    const reads = await openBrowsePageFor(30_000, 'browse-poll-first-read-fails');

    expect(reads.length, 'a failed first read was not retried within half a minute').toBeGreaterThanOrEqual(3);
    for (const gap of gapsBetween(reads)) {
      expect(gap, 'a failed first read waited the routine minute').toBeLessThanOrEqual(10_000);
    }
  });

  /**
   * The source is part of the poll's key, so a viewer who switches gateway looks at a list being read
   * for the first time again. A list shown from the gateway left behind says nothing about the new one.
   */
  it('retries a failed first read on a newly chosen source within a few seconds, though the old one was shown', async () => {
    const firstSource = 'browse-poll-switch-from';
    const switchedSource = 'browse-poll-switch-to';
    app.fails = () => app.sourceId === switchedSource;
    await openBrowsePageFor(1_000, firstSource);
    expect(app.readsAtMs.length, 'the first source was never read').toBe(1);

    app.sourceId = switchedSource;
    app.readsAtMs = [];
    mounted?.render(createElement(StreamBrowser));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    const reads = [...app.readsAtMs];

    expect(
      reads.length,
      'a failed first read on the new source was not retried within half a minute',
    ).toBeGreaterThanOrEqual(3);
    for (const gap of gapsBetween(reads)) {
      expect(gap, 'a failed first read on the new source waited the routine minute').toBeLessThanOrEqual(10_000);
    }
  });

  it('waits the routine minute after a failed read once the list has been shown', async () => {
    app.fails = (readsBefore) => readsBefore > 0;
    const reads = await openBrowsePageFor(4 * SKIP_MS, 'browse-poll-later-reads-fail');

    expect(reads.length, 'a failed read stopped the page reading').toBeGreaterThan(2);
    for (const gap of gapsBetween(reads)) {
      expect(gap, 'a failed read after the list was shown was retried more than once a minute').toBeGreaterThanOrEqual(
        SKIP_MS,
      );
    }
  });
});
