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
  fails: false,
}));

vi.mock('../src/app/AppProvider', () => ({
  useAppContext: () => ({
    streamList: [],
    isStreamListFromCurrentGateway: true,
    theme: { heroTitle: 'Streams', heroSubtitle: '', footer: {} },
    streamListSourceId: app.sourceId,
    fetchAppState: async () => {
      app.readsAtMs.push(Date.now());
      if (app.fails) {
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
    app.fails = false;
    const reads = await openBrowsePageFor(4 * SKIP_MS, 'browse-poll-answered');

    expect(reads.length, 'an open page stopped reading the list').toBeGreaterThan(1);
    for (const gap of gapsBetween(reads)) {
      expect(gap, 'the list was asked more than once a minute').toBeGreaterThanOrEqual(SKIP_MS);
    }
  });

  it('keeps the same pace after failed reads, never faster and never a growing backoff', async () => {
    app.fails = true;
    const reads = await openBrowsePageFor(4 * SKIP_MS, 'browse-poll-failing');

    expect(reads.length, 'a failed read stopped the page reading').toBeGreaterThan(1);
    for (const gap of gapsBetween(reads)) {
      expect(gap, 'a failed read was retried more than once a minute').toBeGreaterThanOrEqual(SKIP_MS);
    }
  });
});
