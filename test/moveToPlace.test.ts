// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DURATION_SETTLED_MS, moveToPlace } from '../src/features/player/placeAcrossSwap';

/**
 * Where weeb-3's video goes when the recording it rebuilds stops growing short of the viewer's place. The hold that
 * waits for it must end, near the place and never back at the start.
 */

interface Video {
  readonly media: HTMLVideoElement;
  /** Sets the duration the way a growing playlist announces it. */
  durationTo(durationS: number): void;
  plays: number;
}

function video(): Video {
  const media = document.createElement('video');
  let positionS = 0;
  let paused = true;
  let durationS = NaN;
  let readyState = 0;
  const handle: Video = {
    media,
    plays: 0,
    durationTo(next) {
      const isFirst = readyState === 0;
      durationS = next;
      readyState = 1;
      media.dispatchEvent(new Event('durationchange'));
      if (isFirst) {
        media.dispatchEvent(new Event('loadedmetadata'));
      }
    },
  };
  Object.defineProperties(media, {
    currentTime: {
      configurable: true,
      get: () => positionS,
      set: (value: number) => {
        positionS = value;
      },
    },
    duration: { configurable: true, get: () => durationS },
    paused: { configurable: true, get: () => paused },
    readyState: { configurable: true, get: () => readyState },
    play: {
      configurable: true,
      value: () => {
        handle.plays += 1;
        paused = false;
        media.dispatchEvent(new Event('play'));
        return Promise.resolve();
      },
    },
    pause: {
      configurable: true,
      value: () => {
        paused = true;
      },
    },
  });
  return handle;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('moving to a place weeb-3 rebuilds its way to', () => {
  it('goes a second short of the end and plays when the recording stops growing before the place', () => {
    const v = video();
    const onArrived = vi.fn();
    moveToPlace(v.media, { positionS: 900, paused: false }, onArrived);

    v.durationTo(8);
    vi.advanceTimersByTime(5_000);
    v.durationTo(600);
    vi.advanceTimersByTime(DURATION_SETTLED_MS - 1);
    expect(v.media.currentTime).toBe(0);
    expect(onArrived).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(v.media.currentTime).toBe(599);
    expect(v.media.paused).toBe(false);
    expect(onArrived).toHaveBeenCalledTimes(1);
  });

  it('stays paused at the end it reached when the viewer had paused', () => {
    const v = video();
    moveToPlace(v.media, { positionS: 900, paused: true }, () => undefined);

    v.durationTo(600);
    vi.advanceTimersByTime(DURATION_SETTLED_MS);

    expect(v.media.currentTime).toBe(599);
    expect(v.media.paused).toBe(true);
    expect(v.plays).toBe(0);
  });

  it('still waits out the measured growth, 8 s at its metadata and the whole length about 9 s later', () => {
    const v = video();
    moveToPlace(v.media, { positionS: 58, paused: false }, () => undefined);

    v.durationTo(8);
    vi.advanceTimersByTime(9_000);
    v.durationTo(1483);

    expect(v.media.currentTime).toBe(58);
  });

  it('lets go of the video once detached: no hold on a play, and no move when the wait would have ended', () => {
    const v = video();
    const onArrived = vi.fn();
    const detach = moveToPlace(v.media, { positionS: 900, paused: false }, onArrived);
    v.durationTo(600);

    detach();
    void v.media.play();
    vi.advanceTimersByTime(DURATION_SETTLED_MS);
    v.durationTo(1483);

    expect(v.media.paused).toBe(false);
    expect(v.media.currentTime).toBe(0);
    expect(onArrived).not.toHaveBeenCalled();
  });
});
