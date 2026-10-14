import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

import {
  attachResumeOnReturn,
  decideOnReturn,
  type LivePlayer,
  type ReturnPage,
  type ReturnSnapshot,
} from '../src/features/player/resumeOnReturn';

/** A live viewer playing close to the live edge, which a return must leave alone. */
const PLAYING_NEAR_LIVE: ReturnSnapshot = {
  isLive: true,
  isPaused: false,
  pausedAtMs: null,
  hiddenAtMs: 10_000,
  behindLiveS: 14,
  maxLatencyS: 24,
};

/**
 * SPDV-1655. An iPhone pauses the video when the phone locks and Safari does not resume it on unlock,
 * so a live viewer came back to a stopped player. A return resumes a pause the system made, and only
 * that one.
 *
 * Written in milliseconds and seconds rather than against the module's constants, so that a change to
 * the window is a change a test notices.
 */
describe('what the player does when the page becomes visible again', () => {
  it('resumes at live a pause that came while the page was hidden', () => {
    const decision = decideOnReturn({ ...PLAYING_NEAR_LIVE, isPaused: true, pausedAtMs: 10_050 });
    assert.equal(decision, 'resume-at-live');
  });

  it('resumes at live a pause that came just before the page was hidden', () => {
    const decision = decideOnReturn({ ...PLAYING_NEAR_LIVE, isPaused: true, pausedAtMs: 9_200 });
    assert.equal(decision, 'resume-at-live');
  });

  it('resumes at live a pause that came exactly one second before the page was hidden', () => {
    const decision = decideOnReturn({ ...PLAYING_NEAR_LIVE, isPaused: true, pausedAtMs: 9_000 });
    assert.equal(decision, 'resume-at-live');
  });

  it('leaves a pause the viewer made while the page was visible', () => {
    const decision = decideOnReturn({ ...PLAYING_NEAR_LIVE, isPaused: true, pausedAtMs: 8_900 });
    assert.equal(decision, 'leave');
  });

  it('leaves a paused player whose pause it never saw', () => {
    const decision = decideOnReturn({ ...PLAYING_NEAR_LIVE, isPaused: true, pausedAtMs: null });
    assert.equal(decision, 'leave');
  });

  it('leaves a paused player when it never saw the page hidden', () => {
    const decision = decideOnReturn({ ...PLAYING_NEAR_LIVE, isPaused: true, pausedAtMs: 10_050, hiddenAtMs: null });
    assert.equal(decision, 'leave');
  });

  it('leaves a player that is playing close to live', () => {
    assert.equal(decideOnReturn(PLAYING_NEAR_LIVE), 'leave');
  });

  it('leaves a player that is playing exactly at the live limit', () => {
    assert.equal(decideOnReturn({ ...PLAYING_NEAR_LIVE, behindLiveS: 24 }), 'leave');
  });

  it('moves to live a player that is playing further behind than the live limit allows', () => {
    assert.equal(decideOnReturn({ ...PLAYING_NEAR_LIVE, behindLiveS: 24.5 }), 'jump-to-live');
  });

  it('leaves a playing player whose distance from live is not known', () => {
    assert.equal(decideOnReturn({ ...PLAYING_NEAR_LIVE, behindLiveS: null }), 'leave');
  });

  it('leaves a recording, paused by the system or far behind', () => {
    assert.equal(decideOnReturn({ ...PLAYING_NEAR_LIVE, isLive: false, isPaused: true, pausedAtMs: 10_050 }), 'leave');
    assert.equal(decideOnReturn({ ...PLAYING_NEAR_LIVE, isLive: false, behindLiveS: 600 }), 'leave');
  });
});

type PageEventName = 'visibilitychange' | 'pagehide' | 'pageshow';
type MediaEventName = 'pause' | 'play';

/** Listeners keyed on their event type, as a real target keeps them, so a wrong event name fails. */
function makeTarget<T extends string>() {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  return {
    addEventListener: (type: T, listener: (event: Event) => void) => {
      const forType = listeners.get(type) ?? new Set();
      forType.add(listener);
      listeners.set(type, forType);
    },
    removeEventListener: (type: T, listener: (event: Event) => void) => {
      listeners.get(type)?.delete(listener);
    },
    emit: (type: T, event: Partial<Event> & Record<string, unknown> = {}) => {
      for (const listener of [...(listeners.get(type) ?? [])]) {
        listener(event as Event);
      }
    },
    count: () => [...listeners.values()].reduce((total, forType) => total + forType.size, 0),
  };
}

function makeStage(options: { isLive?: boolean; currentTime?: number; play?: () => Promise<void> } = {}) {
  let clockMs = 0;
  const page = { ...makeTarget<PageEventName>(), visibilityState: 'visible' as DocumentVisibilityState };
  const mediaEvents = makeTarget<MediaEventName>();
  const play = vi.fn(options.play ?? (() => Promise.resolve()));
  const media = {
    ...mediaEvents,
    paused: false,
    currentTime: options.currentTime ?? 100,
    play,
  };
  const startLoad = vi.fn();
  const player: LivePlayer = {
    liveSyncPosition: 130,
    maxLatency: 24,
    latestLevelDetails: { live: options.isLive ?? true, edge: 140, age: 2 },
    startLoad,
  };
  const reportPlayFailure = vi.fn();
  const detach = attachResumeOnReturn(
    media as unknown as HTMLMediaElement,
    { document: page, window: page } as unknown as ReturnPage,
    player,
    reportPlayFailure,
    () => clockMs,
  );
  return {
    media,
    page,
    play,
    startLoad,
    reportPlayFailure,
    detach,
    at: (ms: number) => {
      clockMs = ms;
    },
    hide: () => {
      page.visibilityState = 'hidden';
      page.emit('visibilitychange');
    },
    show: () => {
      page.visibilityState = 'visible';
      page.emit('visibilitychange');
    },
    systemPause: () => {
      media.paused = true;
      mediaEvents.emit('pause');
    },
    listenerCount: () => page.count() + mediaEvents.count(),
  };
}

describe('the player wired to the page coming back', () => {
  it('resumes at the live position a playback the lock paused', async () => {
    const stage = makeStage({ currentTime: 100 });
    stage.at(5_000);
    stage.hide();
    stage.at(5_200);
    stage.systemPause();
    stage.at(65_000);
    stage.show();
    await Promise.resolve();

    assert.equal(stage.media.currentTime, 130);
    assert.deepEqual(stage.startLoad.mock.calls, [[130]]);
    assert.equal(stage.play.mock.calls.length, 1);
  });

  it('resumes a pause that landed in the second before the page was hidden', () => {
    const stage = makeStage();
    stage.at(4_400);
    stage.systemPause();
    stage.at(5_000);
    stage.hide();
    stage.at(65_000);
    stage.show();

    assert.equal(stage.play.mock.calls.length, 1);
  });

  it('leaves a pause the viewer made before leaving the page', () => {
    const stage = makeStage();
    stage.at(1_000);
    stage.systemPause();
    stage.at(5_000);
    stage.hide();
    stage.at(65_000);
    stage.show();

    assert.equal(stage.play.mock.calls.length, 0);
    assert.equal(stage.startLoad.mock.calls.length, 0);
    assert.equal(stage.media.currentTime, 100);
  });

  it('acts on a page restored from the back-forward cache', () => {
    const stage = makeStage();
    stage.at(5_000);
    stage.page.emit('pagehide', { persisted: true });
    stage.at(5_100);
    stage.systemPause();
    stage.at(65_000);
    stage.page.emit('pageshow', { persisted: true });

    assert.equal(stage.play.mock.calls.length, 1);
  });

  it('ignores a first page load, which is not a return', () => {
    const stage = makeStage();
    stage.at(5_000);
    stage.page.emit('pagehide', { persisted: true });
    stage.systemPause();
    stage.page.emit('pageshow', { persisted: false });

    assert.equal(stage.play.mock.calls.length, 0);
  });

  it('leaves a recording paused by the lock', () => {
    const stage = makeStage({ isLive: false });
    stage.at(5_000);
    stage.hide();
    stage.systemPause();
    stage.show();

    assert.equal(stage.play.mock.calls.length, 0);
  });

  it('leaves a player that resumed by itself close to live', () => {
    const stage = makeStage({ currentTime: 125 });
    stage.at(5_000);
    stage.hide();
    stage.show();

    assert.equal(stage.play.mock.calls.length, 0);
    assert.equal(stage.startLoad.mock.calls.length, 0);
  });

  it('moves to live a player that resumed by itself too far behind', () => {
    // Live edge 140 played two seconds ago, so 142 now, and 100 is 42 s behind against a limit of 24.
    const stage = makeStage({ currentTime: 100 });
    stage.at(5_000);
    stage.hide();
    stage.show();

    assert.equal(stage.media.currentTime, 130);
    assert.deepEqual(stage.startLoad.mock.calls, [[130]]);
    assert.equal(stage.play.mock.calls.length, 1);
  });

  it('reports a refused play rather than throwing it', async () => {
    const refusal = new Error('NotAllowedError');
    const stage = makeStage({ play: () => Promise.reject(refusal) });
    stage.at(5_000);
    stage.hide();
    stage.systemPause();
    stage.show();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(stage.reportPlayFailure.mock.calls, [[refusal]]);
  });

  it('removes every listener it added', () => {
    const stage = makeStage();
    assert.ok(stage.listenerCount() > 0);
    stage.detach();
    assert.equal(stage.listenerCount(), 0);
  });
});
