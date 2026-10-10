// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OwnPlayerStage, PLAY_FAILED } from '../src/features/player/OwnPlayerStage';
import type { OwnPlayer, PlaybackStart, ProviderStatus } from '../src/swarm/provider';
import { mount, type Mounted } from './helpers/dom';

const OWNER = 'a'.repeat(40);
const TOPIC = 'stream-one';

let mounted: Mounted | null = null;
let nodeStatus: ProviderStatus = { state: 'ready', peers: 5 };

interface Attached {
  readonly video: HTMLVideoElement;
  readonly owner: string;
  readonly topic: string;
  readonly from: PlaybackStart;
}

function player() {
  const attached: Attached[] = [];
  const detached = { count: 0 };
  const own: OwnPlayer = {
    attach: async (video, owner, topic, from) => {
      attached.push({ video, owner, topic, from });
    },
    detach: () => {
      detached.count += 1;
    },
  };
  return { attached, detached, load: async () => own };
}

function render(load: () => Promise<OwnPlayer>, from: PlaybackStart = 'live') {
  mounted = mount(createElement(OwnPlayerStage, { load, status: () => nodeStatus, owner: OWNER, topic: TOPIC, from }));
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const line = () => document.querySelector('.own-player-status')?.textContent ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  nodeStatus = { state: 'ready', peers: 5 };
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
    await wait(0);

    expect(attached).toHaveLength(1);
    expect(attached[0]).toMatchObject({ owner: OWNER, topic: TOPIC, from: 'live' });
    expect(attached[0].video.controls).toBe(true);
    expect(document.querySelector('.feed-state-overlay, .qoe-overlay, .swarm-hls-player-wrapper')).toBeNull();
  });

  it('plays a finished stream from its beginning', async () => {
    const { attached, load } = player();
    render(load, 'beginning');
    await wait(0);

    expect(attached[0].from).toBe('beginning');
  });

  it('shows how the node gets ready, its download and its peers, and nothing once it is ready', async () => {
    nodeStatus = { state: 'starting', peers: 0, download: { receivedBytes: 1, totalBytes: 4 } };
    render(player().load);
    await wait(0);
    expect(line()).toBe('Downloading 25%');

    nodeStatus = { state: 'starting', peers: 2 };
    await wait(500);
    expect(line()).toBe('Connecting, 2 peers');

    nodeStatus = { state: 'ready', peers: 3 };
    await wait(500);
    expect(line()).toBeNull();
  });

  it('says plainly that it cannot play when the player cannot attach, and stays on this source', async () => {
    render(async () => ({
      attach: async () => {
        throw new Error('the fake refuses');
      },
      detach: () => undefined,
    }));
    await wait(0);
    expect(line()).toBe(PLAY_FAILED);

    await wait(120_000);

    expect(line()).toBe(PLAY_FAILED);
    expect(document.querySelectorAll('video')).toHaveLength(1);
    expect(document.querySelector('.swarm-hls-player-wrapper')).toBeNull();
  });

  it('lets go of the player when the stage goes, so the node can stop', async () => {
    const { detached, load } = player();
    render(load);
    await wait(0);

    mounted?.unmount();
    mounted = null;

    expect(detached.count).toBe(1);
  });

  it('lets go of a player that arrives after the stage has gone', async () => {
    const { attached, detached, load } = player();
    let arrive: () => void = () => undefined;
    const late = () =>
      new Promise<OwnPlayer>((resolve) => {
        arrive = () => void load().then(resolve);
      });
    render(late);
    mounted?.unmount();
    mounted = null;

    arrive();
    await wait(0);

    expect(detached.count).toBe(1);
    expect(attached).toEqual([]);
  });

  it('says the same when the player cannot load', async () => {
    render(async () => {
      throw new Error('the chunk did not load');
    });
    await wait(0);

    expect(line()).toBe(PLAY_FAILED);
  });
});
