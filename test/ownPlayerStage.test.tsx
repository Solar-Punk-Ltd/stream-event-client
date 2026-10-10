// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FIRST_PICTURE_DEADLINE_MS, OwnPlayerStage } from '../src/features/player/OwnPlayerStage';
import type { OwnPlayer, PlaybackStart } from '../src/swarm/provider';
import { mount, type Mounted } from './helpers/dom';

const OWNER = 'a'.repeat(40);
const TOPIC = 'stream-one';

let mounted: Mounted | null = null;

interface Attached {
  readonly video: HTMLVideoElement;
  readonly owner: string;
  readonly topic: string;
  readonly from: PlaybackStart;
}

function player(onAttach: (video: HTMLVideoElement) => void = () => undefined) {
  const attached: Attached[] = [];
  const own: OwnPlayer = {
    attach: async (video, owner, topic, from) => {
      attached.push({ video, owner, topic, from });
      onAttach(video);
    },
  };
  return { attached, load: async () => own };
}

/** Makes a video element report a picture the way a browser does once it can play on. */
function showPicture(video: HTMLVideoElement) {
  Object.defineProperty(video, 'readyState', { configurable: true, value: HTMLMediaElement.HAVE_FUTURE_DATA });
  video.dispatchEvent(new Event('playing'));
}

function render(load: () => Promise<OwnPlayer>, from: PlaybackStart = 'live') {
  mounted = mount(
    createElement(OwnPlayerStage, {
      load,
      owner: OWNER,
      topic: TOPIC,
      from,
      startingNotice: 'Starting the node in this browser',
      fallback: createElement('div', { 'data-testid': 'our-player' }),
    }),
  );
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const ourPlayer = () => document.querySelector('[data-testid="our-player"]');
const status = () => document.querySelector('[role="status"]')?.textContent ?? null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe("a source's own player", () => {
  it('plays the stream into a video the page owns, live from its newest entry, with no overlay of ours', async () => {
    const { attached, load } = player();
    render(load);
    await flush();

    expect(attached).toHaveLength(1);
    expect(attached[0]).toMatchObject({ owner: OWNER, topic: TOPIC, from: 'live' });
    expect(attached[0].video.controls).toBe(true);
    expect(document.querySelector('.feed-state-overlay, .qoe-overlay')).toBeNull();
  });

  it('plays a finished stream from its beginning', async () => {
    const { attached, load } = player();
    render(load, 'beginning');
    await flush();

    expect(attached[0].from).toBe('beginning');
  });

  it('says plainly that it is starting until the first picture, then says nothing', async () => {
    const { load } = player((video) => setTimeout(() => showPicture(video), 5_000));
    render(load);
    await flush();
    expect(status()).toBe('Starting the node in this browser');

    await wait(5_000);

    expect(status()).toBeNull();
    await wait(FIRST_PICTURE_DEADLINE_MS);
    expect(ourPlayer()).toBeNull();
  });

  it("swaps in the app's player when no picture comes within the deadline", async () => {
    const { load } = player();
    render(load);
    await flush();

    await wait(FIRST_PICTURE_DEADLINE_MS - 1);
    expect(ourPlayer()).toBeNull();
    await wait(1);

    expect(ourPlayer()).not.toBeNull();
    expect(document.querySelectorAll('video')).toHaveLength(0);
    expect(status()).toBeNull();
  });

  it("swaps in the app's player at once when the player cannot attach", async () => {
    render(async () => ({
      attach: async () => {
        throw new Error('weeb-3 is not part of this build yet');
      },
    }));
    await flush();

    expect(ourPlayer()).not.toBeNull();
  });

  it("swaps in the app's player at once when the player cannot load", async () => {
    render(async () => {
      throw new Error('the chunk did not load');
    });
    await flush();

    expect(ourPlayer()).not.toBeNull();
  });

  it('counts a picture by playback moving on as well as by what the browser holds', async () => {
    const { load } = player((video) => {
      Object.defineProperty(video, 'currentTime', { configurable: true, value: 0.5 });
      video.dispatchEvent(new Event('timeupdate'));
    });
    render(load);
    await flush();
    await wait(FIRST_PICTURE_DEADLINE_MS);

    expect(ourPlayer()).toBeNull();
  });
});
