// @vitest-environment jsdom
import { act, createElement } from 'react';
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from 'react-router';
import { Events } from 'hls.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MOVING_TO_PLACE } from '../src/features/player/OwnPlayerStage';
import { StreamWatcher } from '../src/features/player/StreamWatcher/StreamWatcher';
import type { OwnPlayer, ProviderStatus } from '../src/swarm/provider';
import { fakeWeeb3Package } from './helpers/fakeWeeb3';
import { mount, settle, type Mounted } from './helpers/dom';

/**
 * Where a viewer is in a recording after moving the video between weeb-3's own player and the app's. Measured on
 * 2026-10-18 on rc.4: a move between two gateways kept the place, and any move to or from Weeb3 started the
 * recording again, because the watch page swaps one player component for the other. A live stream joins at its live
 * edge in either player, as it always has.
 *
 * hls.js is a stub that records where the app's player is asked to start. weeb-3 is the repository's fake package,
 * and the videos say where they are through a stub of their playhead, which jsdom does not play.
 */

const OWNER = 'a'.repeat(40);
const TOPIC = 'recorded-talk';
const OTHER_TOPIC = 'another-recorded-talk';

type Handler = (event: string, data: unknown) => void;

const fakes = vi.hoisted(() => ({
  hls: [] as Array<{ handlers: Map<string, Handler[]>; startLoads: Array<number | undefined> }>,
}));

vi.mock('hls.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('hls.js')>();
  class FakeHls {
    static isSupported() {
      return true;
    }
    static DefaultConfig = actual.default.DefaultConfig;
    handlers = new Map<string, Handler[]>();
    startLoads: Array<number | undefined> = [];
    levels: unknown[] = [];
    currentLevel = -1;
    constructor() {
      fakes.hls.push(this);
    }
    on(event: string, handler: Handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    }
    off() {}
    attachMedia() {}
    loadSource() {}
    startLoad(position?: number) {
      this.startLoads.push(position);
    }
    stopLoad() {}
    destroy() {}
  }
  return { ...actual, default: FakeHls };
});

vi.mock('../src/features/player/CustomManifestLoader', () => ({
  CustomManifestLoader: class {},
  CustomFragmentLoader: class {},
  manifestFetcher: {
    feedHealth: { subscribe: () => () => undefined, recordPlaybackStall: () => undefined },
    registerLadder: () => undefined,
    unregisterLadder: () => undefined,
    watchLadderCompletion: () => () => undefined,
    followOnlyRung: () => undefined,
    attachPlayhead: () => () => undefined,
    markLiveSegmentGap: () => false,
    reportSegmentLoad: () => undefined,
    startsSlowly: () => false,
    subscribeStartsSlowly: () => () => undefined,
  },
}));

const { noDetach } = vi.hoisted(() => ({ noDetach: () => () => undefined }));
vi.mock('../src/features/player/rungHealth', () => ({
  attachActiveRungFollower: noDetach,
  attachRungFailover: noDetach,
  attachWatchedRungReporter: noDetach,
}));
vi.mock('../src/features/player/liveSyncLength', () => ({ attachLiveSyncToSegmentLength: noDetach }));
vi.mock('../src/features/player/playbackHealth', () => ({ attachPlaybackStallReporter: noDetach }));
vi.mock('../src/features/player/returningBroadcast', () => ({ attachReturningBroadcastRejoin: noDetach }));
vi.mock('../src/features/player/resumeOnReturn', () => ({ attachResumeOnReturn: noDetach }));
vi.mock('../src/features/catalog/useCatalogPoll', () => ({ useCatalogPoll: () => undefined }));

interface OwnPlayerHandle {
  readonly id: string;
  readonly load: () => Promise<OwnPlayer>;
  readonly status: () => ProviderStatus;
}

const page = vi.hoisted(() => ({
  ownPlayer: null as OwnPlayerHandle | null,
  state: 'vod',
}));

vi.mock('../src/app/AppProvider', () => ({
  useAppContext: () => ({
    streamList: [TOPIC, OTHER_TOPIC].map((topic) => ({
      owner: OWNER,
      topic,
      title: 'A talk',
      timestamp: 1,
      mediatype: 'video',
      state: page.state,
    })),
    isStreamListLoaded: true,
    chat: null,
    readNextStreamListSlot: () => undefined,
    sources: [{ id: 'gateway', type: 'gateway', name: 'Event gateway', url: '/bee', offered: true }],
    parts: { player: 'gateway', 'stream-list': 'gateway', previews: 'gateway', chat: 'gateway' },
    swarm: {
      ownPlayer: (feature: string) => (feature === 'player' ? page.ownPlayer : null),
      reader: () => ({ urlFor: () => null }),
    },
  }),
}));

/** A video's playhead as a test sets it, with the play and pause jsdom does not carry out. */
interface StubbedPlayhead {
  positionS: number;
  paused: boolean;
  readyState: number;
  durationS: number;
  plays: number;
}

const playheads = new WeakMap<HTMLMediaElement, StubbedPlayhead>();

function stubPlayhead(media: HTMLMediaElement): StubbedPlayhead {
  const known = playheads.get(media);
  if (known) {
    return known;
  }
  const playhead: StubbedPlayhead = { positionS: 0, paused: true, readyState: 0, durationS: NaN, plays: 0 };
  Object.defineProperties(media, {
    currentTime: {
      configurable: true,
      get: () => playhead.positionS,
      set: (value: number) => {
        playhead.positionS = value;
      },
    },
    paused: { configurable: true, get: () => playhead.paused },
    readyState: { configurable: true, get: () => playhead.readyState },
    duration: { configurable: true, get: () => playhead.durationS },
    play: {
      configurable: true,
      value: () => {
        playhead.plays += 1;
        playhead.paused = false;
        media.dispatchEvent(new Event('play'));
        return Promise.resolve();
      },
    },
    pause: {
      configurable: true,
      value: () => {
        if (!playhead.paused) {
          playhead.paused = true;
          media.dispatchEvent(new Event('pause'));
        }
      },
    },
    load: { configurable: true, value: () => undefined },
  });
  playheads.set(media, playhead);
  return playhead;
}

let mounted: Mounted | null = null;
let weeb3: ReturnType<typeof fakeWeeb3Package>;

/** weeb-3's player as the client hands it out, on a node of the fake package that is already ready. */
async function weeb3Player(): Promise<OwnPlayerHandle> {
  const pkg = await weeb3.load();
  const node = new pkg.Weeb3No103();
  const own: OwnPlayer = {
    attach: (video, owner, topic, from) => node.attachStream(video, owner, topic, from),
    detach: () => undefined,
  };
  return { id: 'weeb-3', load: async () => own, status: () => ({ state: 'ready', peers: 5, healthyPeers: 200 }) };
}

let navigate: NavigateFunction | null = null;

function NavigateProbe() {
  navigate = useNavigate();
  return null;
}

function watchPage() {
  return createElement(
    MemoryRouter,
    { initialEntries: [`/watch/video/${OWNER}/${TOPIC}`] },
    createElement(NavigateProbe),
    createElement(
      Routes,
      null,
      createElement(Route, { path: '/watch/:mediatype/:owner/:topic', element: createElement(StreamWatcher) }),
    ),
  );
}

/** Opens another recording on the same watch page, as a link to it does. */
function openOtherRecording(): void {
  act(() => {
    void navigate!(`/watch/video/${OWNER}/${OTHER_TOPIC}`);
  });
}

function appVideo(): HTMLVideoElement {
  const video = document.querySelector<HTMLVideoElement>('.swarm-hls-player-wrapper video');
  if (!video) {
    throw new Error("the app's player is not showing");
  }
  return video;
}

function weeb3Video(): HTMLVideoElement {
  const video = document.querySelector<HTMLVideoElement>('.own-player video');
  if (!video) {
    throw new Error("weeb-3's player is not showing");
  }
  return video;
}

function emit(index: number, event: string, data: unknown = {}): void {
  act(() => {
    for (const handler of fakes.hls[index].handlers.get(event) ?? []) {
      handler(event, data);
    }
  });
}

/** Plays a video to `positionS`, or pauses it there, the way a viewer does. */
function playheadTo(media: HTMLMediaElement, positionS: number, paused: boolean): void {
  const playhead = stubPlayhead(media);
  act(() => {
    Object.assign(playhead, { positionS, readyState: 4 });
    if (paused) {
      media.pause();
    } else {
      void media.play();
    }
  });
}

/** The page on the app's player, played to `positionS`. */
function watchOnAppPlayer(positionS: number, paused = false): void {
  page.ownPlayer = null;
  mounted = mount(watchPage());
  stubPlayhead(appVideo());
  emit(0, Events.MANIFEST_PARSED);
  emit(0, Events.LEVEL_LOADED, { details: { live: page.state !== 'vod' } });
  playheadTo(appVideo(), positionS, paused);
}

/** The page on weeb-3's player, played to `positionS`. */
async function watchOnWeeb3(positionS: number, paused = false): Promise<void> {
  page.ownPlayer = await weeb3Player();
  mounted = mount(watchPage());
  await settle();
  playheadTo(weeb3Video(), positionS, paused);
}

const RECORDING_S = 1483;

/** A video's duration as it grows, announced the way the media does. */
function durationTo(media: HTMLMediaElement, durationS: number): void {
  const playhead = stubPlayhead(media);
  const isFirst = playhead.readyState === 0;
  act(() => {
    Object.assign(playhead, { durationS, readyState: Math.max(playhead.readyState, 1) });
    media.dispatchEvent(new Event('durationchange'));
    if (isFirst) {
      media.dispatchEvent(new Event('loadedmetadata'));
    }
  });
}

/**
 * Moves the video to weeb-3 and lets its player attach. weeb-3 names a few seconds of a recording at its metadata and
 * the whole of it once its playlist is rebuilt, as it did on 2026-10-18, unless `wholeAtOnce`.
 */
async function moveToWeeb3(wholeAtOnce = false): Promise<HTMLVideoElement> {
  page.ownPlayer = await weeb3Player();
  mounted!.render(watchPage());
  await settle();
  const video = weeb3Video();
  if (!wholeAtOnce) {
    durationTo(video, 8);
  }
  durationTo(video, RECORDING_S);
  return video;
}

/** Moves the video to a gateway, which the app's player plays, and lets that player parse its manifest. */
function moveToAppPlayer(): HTMLVideoElement {
  page.ownPlayer = null;
  mounted!.render(watchPage());
  const video = appVideo();
  stubPlayhead(video);
  emit(fakes.hls.length - 1, Events.MANIFEST_PARSED);
  return video;
}

beforeEach(() => {
  fakes.hls.length = 0;
  page.state = 'vod';
  weeb3 = fakeWeeb3Package({
    onAttach: (media) => {
      stubPlayhead(media);
      if (media.autoplay) {
        void media.play();
      }
    },
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('a recording, when the video moves between weeb-3 and the app’s player', () => {
  it("keeps the viewer's place when it moves from the app's player to weeb-3's", async () => {
    watchOnAppPlayer(58);

    const video = await moveToWeeb3();

    expect(weeb3.nodes[0].attached.map(({ start }) => start)).toEqual(['beginning']);
    expect(video.currentTime).toBe(58);
    expect(video.paused).toBe(false);
  });

  it('moves to the place at once on weeb-3 when the whole recording is known at its metadata', async () => {
    watchOnAppPlayer(58);

    const video = await moveToWeeb3(true);

    expect(video.currentTime).toBe(58);
  });

  it('waits on weeb-3 for the recording to reach the place rather than land at the end of the first seconds', async () => {
    watchOnAppPlayer(58);
    page.ownPlayer = await weeb3Player();
    mounted!.render(watchPage());
    await settle();
    const video = weeb3Video();

    durationTo(video, 8);
    expect(video.currentTime).toBe(0);
    durationTo(video, 30);
    expect(video.currentTime).toBe(0);
    durationTo(video, RECORDING_S);

    expect(video.currentTime).toBe(58);
  });

  // The owner's ruling: the first seconds of the recording do not play while weeb-3's player waits.
  it('holds weeb-3’s video still with a line under it until it reaches the place, then plays from there', async () => {
    watchOnAppPlayer(58);
    page.ownPlayer = await weeb3Player();
    mounted!.render(watchPage());
    await settle();
    const video = weeb3Video();

    durationTo(video, 8);
    void video.play();
    expect(video.paused).toBe(true);
    expect(document.querySelector('.own-player-words')?.textContent).toBe(MOVING_TO_PLACE);

    durationTo(video, RECORDING_S);
    await settle();

    expect(video.currentTime).toBe(58);
    expect(video.paused).toBe(false);
    expect(document.querySelector('.own-player-status')).toBeNull();
  });

  it('keeps the place the viewer had when they leave weeb-3 before it got there', async () => {
    watchOnAppPlayer(58);
    page.ownPlayer = await weeb3Player();
    mounted!.render(watchPage());
    await settle();
    const waiting = weeb3Video();
    durationTo(waiting, 8);
    playheadTo(waiting, 2, false);

    moveToAppPlayer();

    expect(fakes.hls.at(-1)!.startLoads[0]).toBe(58);
  });

  it("keeps the viewer's place when it moves from weeb-3's player to the app's", async () => {
    await watchOnWeeb3(58);

    moveToAppPlayer();

    expect(fakes.hls.at(-1)!.startLoads[0]).toBe(58);
  });

  // hls.js forgets a start position when `startLoad` is called again before a segment is in, and the play that
  // autoplay starts calls it at once.
  it("keeps the place through the app's player starting to play, until its first segment is in", async () => {
    await watchOnWeeb3(58);

    moveToAppPlayer();
    const { startLoads } = fakes.hls.at(-1)!;
    expect(startLoads.length).toBeGreaterThan(1);
    expect(new Set(startLoads)).toEqual(new Set([58]));

    emit(fakes.hls.length - 1, Events.FRAG_BUFFERED);
    void appVideo().pause();
    void appVideo().play();
    expect(startLoads.at(-1)).toBeUndefined();
  });

  it('keeps a paused recording paused on weeb-3, at its place', async () => {
    watchOnAppPlayer(58, true);

    const video = await moveToWeeb3();

    expect(video.currentTime).toBe(58);
    expect(video.paused).toBe(true);
    expect(video.autoplay).toBe(false);
  });

  it("keeps a paused recording paused on the app's player, at its place", async () => {
    await watchOnWeeb3(58, true);

    const video = moveToAppPlayer();

    expect(fakes.hls.at(-1)!.startLoads[0]).toBe(58);
    expect(stubPlayhead(video).plays).toBe(0);
    expect(video.autoplay).toBe(false);
  });

  it('keeps the place through a move there and back', async () => {
    watchOnAppPlayer(58);
    const onWeeb3 = await moveToWeeb3();
    playheadTo(onWeeb3, 103, false);

    moveToAppPlayer();

    expect(fakes.hls.at(-1)!.startLoads[0]).toBe(103);
  });
});

describe('a second recording opened on the same watch page', () => {
  it("does not take the first recording's place when the video then moves to weeb-3", async () => {
    watchOnAppPlayer(58);

    openOtherRecording();
    emit(fakes.hls.length - 1, Events.MANIFEST_PARSED);
    const video = await moveToWeeb3();

    expect(weeb3.nodes[0].attached.map(({ topic }) => topic)).toEqual([OTHER_TOPIC]);
    expect(video.currentTime).toBe(0);
  });

  it('keeps the first recording at its own place when the viewer goes back to it on weeb-3', async () => {
    await watchOnWeeb3(40);
    moveToAppPlayer();
    emit(fakes.hls.length - 1, Events.LEVEL_LOADED, { details: { live: false } });
    playheadTo(appVideo(), 58, false);

    openOtherRecording();
    emit(fakes.hls.length - 1, Events.MANIFEST_PARSED);
    emit(fakes.hls.length - 1, Events.LEVEL_LOADED, { details: { live: false } });
    playheadTo(appVideo(), 12, false);
    const onWeeb3 = await moveToWeeb3();
    expect(onWeeb3.currentTime).toBe(12);
    playheadTo(onWeeb3, 20, false);
    act(() => {
      void navigate!(`/watch/video/${OWNER}/${TOPIC}`);
    });
    await settle();
    const backOnFirst = weeb3Video();
    durationTo(backOnFirst, RECORDING_S);

    expect(backOnFirst.currentTime).toBe(58);
  });
});

describe("a recording opened again on the same app's player", () => {
  it('starts at the place it had, as a new player would', async () => {
    await watchOnWeeb3(30);
    moveToAppPlayer();
    emit(fakes.hls.length - 1, Events.LEVEL_LOADED, { details: { live: false } });
    playheadTo(appVideo(), 35, false);

    openOtherRecording();
    emit(fakes.hls.length - 1, Events.MANIFEST_PARSED);
    act(() => {
      void navigate!(`/watch/video/${OWNER}/${TOPIC}`);
    });
    emit(fakes.hls.length - 1, Events.MANIFEST_PARSED);

    expect(fakes.hls.at(-1)!.startLoads[0]).toBe(35);
  });
});

describe('a live stream, when the video moves between weeb-3 and the app’s player', () => {
  it("joins at the live edge on weeb-3's player", async () => {
    page.state = 'live';
    watchOnAppPlayer(58);

    const video = await moveToWeeb3();

    expect(weeb3.nodes[0].attached.map(({ start }) => start)).toEqual(['live']);
    expect(video.currentTime).toBe(0);
  });

  it("joins at the live edge on the app's player", async () => {
    page.state = 'live';
    await watchOnWeeb3(58);

    moveToAppPlayer();

    expect(fakes.hls.at(-1)!.startLoads[0]).toBeUndefined();
  });
});
