// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StreamBrowser } from '../src/features/catalog/StreamBrowser/StreamBrowser';
import { mount, type Mounted } from './helpers/dom';

/**
 * An open page reads the stream list every ten seconds, so a stream published, edited or gone live shows within
 * about that. Every read asks the list's next slot before it is written. On the event gateway's node that cost
 * nothing measurable up to 120 such asks a minute (2026-10-29). Ten seconds keeps a viewer's own node at six a
 * minute, well under the 25 to 40 that delayed a slot on a smaller node.
 */
const POLL_MS = 10_000;

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
    themeContent: { heroTitle: 'Streams', heroSubtitle: '', footer: {} },
    streamListSourceId: app.sourceId,
    sources: [],
    parts: { player: app.sourceId, 'stream-list': app.sourceId, previews: app.sourceId, chat: app.sourceId },
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
  it('reads it again every ten seconds, never faster', async () => {
    app.fails = () => false;
    const reads = await openBrowsePageFor(6 * POLL_MS, 'browse-poll-answered');

    expect(reads.length, 'an open page stopped reading the list').toBeGreaterThan(1);
    for (const gap of gapsBetween(reads)) {
      expect(gap, 'the list was asked more than once in ten seconds').toBeGreaterThanOrEqual(POLL_MS);
    }
  });

  /**
   * SWR drops a refresh that falls inside its de-duplication window. A window as long as the poll put the
   * refresh due right at the poll's end inside it, so the page's first read after the one it opened with was
   * skipped and came a whole interval late.
   */
  it('reads it again after exactly one interval, the first time as every time after', async () => {
    app.fails = () => false;
    const reads = await openBrowsePageFor(4 * POLL_MS, 'browse-poll-no-skipped-read');

    expect(gapsBetween(reads), 'a read was skipped and came an interval late').toEqual([
      POLL_MS,
      POLL_MS,
      POLL_MS,
      POLL_MS,
    ]);
  });

  /** A viewer whose first read fails is retried sooner than the routine read, until the list has been shown once. */
  it('retries a failed first read within a few seconds, until the list has been shown once', async () => {
    app.fails = (readsBefore) => readsBefore < 2;
    const reads = await openBrowsePageFor(30_000, 'browse-poll-first-read-fails');

    expect(reads.length, 'a failed first read was not retried within half a minute').toBeGreaterThanOrEqual(3);
    const twoFailedReadsAndTheirRetry = reads.slice(0, 3);
    for (const gap of gapsBetween(twoFailedReadsAndTheirRetry)) {
      expect(gap, 'a failed first read waited the routine ten seconds').toBeLessThan(POLL_MS);
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
      expect(gap, 'a failed first read on the new source waited the routine ten seconds').toBeLessThan(POLL_MS);
    }
  });

  it('waits the routine ten seconds after a failed read once the list has been shown', async () => {
    app.fails = (readsBefore) => readsBefore > 0;
    const reads = await openBrowsePageFor(6 * POLL_MS, 'browse-poll-later-reads-fail');

    expect(reads.length, 'a failed read stopped the page reading').toBeGreaterThan(2);
    for (const gap of gapsBetween(reads)) {
      expect(gap, 'a failed read after the list was shown was retried sooner than ten seconds').toBeGreaterThanOrEqual(
        POLL_MS,
      );
    }
  });
});
