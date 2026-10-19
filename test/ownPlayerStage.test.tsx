// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BY_PEERS_LABEL, OwnPlayerStage, PLAY_FAILED } from '../src/features/player/OwnPlayerStage';
import type { OwnPlayer, PlaybackStart, PlayerLevel, ProviderStatus } from '../src/swarm/provider';
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

const line = () => document.querySelector('.own-player-words')?.textContent ?? null;
const note = () => document.querySelector('.own-player-hint')?.textContent ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  nodeStatus = { state: 'ready', peers: 5, healthyPeers: 200 };
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

  it('keeps playing when a live stream it is watching turns finished, rather than attaching again from the start', async () => {
    const { attached, detached, load } = player();
    const status = () => nodeStatus;
    render(load, 'live');
    await wait(0);

    mounted!.render(createElement(OwnPlayerStage, { load, status, owner: OWNER, topic: TOPIC, from: 'beginning' }));
    await wait(0);

    expect(attached.map(({ from }) => from)).toEqual(['live']);
    expect(detached.count).toBe(0);
  });

  it('shows the node getting ready, and nothing under the player once it is ready', async () => {
    nodeStatus = { state: 'starting', peers: 0, healthyPeers: 200, download: { receivedBytes: 1, totalBytes: 4 } };
    render(player().load);
    await wait(0);
    expect(line()).toBe('Downloading 25%');
    expect(note()).toBeNull();

    nodeStatus = { state: 'starting', peers: 2, healthyPeers: 200 };
    await wait(500);
    expect(line()).toBe('Connecting, 2 of 200 peers');
    expect(note()).toBe('200 peers is the healthy target');

    nodeStatus = { state: 'ready', peers: 88, healthyPeers: 200 };
    await wait(500);
    expect(document.querySelector('.own-player-status')).toBeNull();
  });

  it('says again where the node is when a ready node loses its peers', async () => {
    render(player().load);
    await wait(0);
    expect(document.querySelector('.own-player-status')).toBeNull();

    nodeStatus = { state: 'lost', peers: 0, healthyPeers: 200 };
    await wait(500);
    expect(line()).toBe('Lost its peers. Open My Swarm to start it again.');
  });

  it('keeps its line beside the video rather than over it', async () => {
    nodeStatus = { state: 'starting', peers: 2, healthyPeers: 200 };
    render(player().load);
    await wait(0);

    expect(document.querySelector('.own-player .own-player-status')).toBeNull();
    expect(document.querySelector('.own-player-status')).not.toBeNull();
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

  it('says the node failed to start, rather than that the stream could not play, when the node itself failed', async () => {
    nodeStatus = { state: 'failed', peers: 0, healthyPeers: 200 };
    render(async () => {
      throw new Error('the node in this browser failed to start');
    });
    await wait(0);

    expect(line()).toBe('Failed to start');
  });

  it('says the same when the player cannot load', async () => {
    render(async () => {
      throw new Error('the chunk did not load');
    });
    await wait(0);

    expect(line()).toBe(PLAY_FAILED);
  });
});

describe("a source's own player's quality", () => {
  const LEVELS: PlayerLevel[] = [
    { level: 0, height: 360, bitrate: 800_000 },
    { level: 1, height: 720, bitrate: 2_500_000 },
    { level: 2, height: 1080, bitrate: 5_000_000 },
  ];

  /** A player whose stream plays `playing` until a level is held, which then plays at once. */
  function qualityPlayer(playing = 2) {
    const held: number[] = [];
    let current = playing;
    let video: HTMLVideoElement | null = null;
    const own: OwnPlayer = {
      attach: async (attachedTo) => {
        video = attachedTo;
        Object.defineProperty(attachedTo, 'paused', { configurable: true, get: () => false });
      },
      detach: () => {},
      quality: () => (video === null ? null : { levels: LEVELS, selectedLevel: current, currentLevel: current }),
      holdQuality: (level) => {
        held.push(level);
        current = level;
      },
    };
    return { held, load: async () => own };
  }

  const qualityLine = () => document.querySelector('.own-player-playing')?.textContent ?? null;
  const picker = () => document.querySelector<HTMLSelectElement>('.own-player-picker select');

  beforeEach(() => {
    localStorage.clear();
  });

  it('shows the peers and the height playing, and offers By peers and every height', async () => {
    nodeStatus = { state: 'ready', peers: 95, healthyPeers: 200 };
    render(qualityPlayer().load);
    await wait(0);

    expect(qualityLine()).toBe('95 peers · 1080p');
    expect([...picker()!.options].map(({ textContent }) => textContent)).toEqual([
      BY_PEERS_LABEL,
      '1080p',
      '720p',
      '360p',
    ]);
    expect(picker()!.value).toBe('by-peers');
  });

  it('goes to the height the peers ask for as soon as a quality plays, then looks again every 5 s', async () => {
    nodeStatus = { state: 'ready', peers: 40, healthyPeers: 200 };
    const { held, load } = qualityPlayer();
    render(load);
    await wait(1_000);

    expect(held).toEqual([0]);
    expect(qualityLine()).toBe('40 peers · 1080p');
    await wait(1_000);
    expect(qualityLine()).toBe('40 peers · 360p');

    nodeStatus = { state: 'ready', peers: 70, healthyPeers: 200 };
    await wait(3_000);
    expect(held, 'not before 5 s have passed').toEqual([0]);
    await wait(2_000);
    expect(held).toEqual([0, 1]);
  });

  it('holds a picked height whatever the peers, and the next stream starts at it', async () => {
    nodeStatus = { state: 'ready', peers: 150, healthyPeers: 200 };
    const { held, load } = qualityPlayer();
    render(load);
    await wait(1_000);

    await act(async () => {
      picker()!.value = '720';
      picker()!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(held).toEqual([1]);
    await wait(10_000);
    expect(held, 'By peers no longer moves it').toEqual([1]);

    mounted?.unmount();
    const next = qualityPlayer();
    render(next.load);
    await wait(1_000);
    expect(picker()!.value).toBe('720');
    expect(next.held).toEqual([1]);
  });

  it('shows no quality line for a player that offers no choice', async () => {
    render(player().load);
    await wait(1_000);

    expect(document.querySelector('.own-player-quality')).toBeNull();
  });
});
