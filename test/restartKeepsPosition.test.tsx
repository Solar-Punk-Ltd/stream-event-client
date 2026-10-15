// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import assert from 'node:assert/strict';
import { ErrorDetails, ErrorTypes, Events } from 'hls.js';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import { MEDIA_TYPE_VIDEO } from '../src/features/catalog/stream';
import { SwarmHlsPlayer } from '../src/features/player/SwarmHlsPlayer';

/**
 * Where the player picks up after it rebuilds itself on a fatal error. Seen live on 2026-10-15: a viewer
 * 2100 s into a 2142 s recording hit a fatal error and was sent back to 0. A recording has a fixed
 * timeline, so the rebuilt player resumes where the viewer was. A live broadcast rejoins at the live
 * edge as it always has, because its timeline is rebuilt from the newest playlist.
 *
 * hls.js is a stub here that records where each player is asked to start. The refusal that caused the
 * 2026-10-15 restart is covered through the real hls.js in `rungDropKeepsPlaying.test.ts`.
 */

type Handler = (event: string, data: unknown) => void;

interface FakeLevelDetails {
  live: boolean;
  targetduration: number;
  fragments: Array<{ start: number; duration: number }>;
}

const fakes = vi.hoisted(() => {
  const instances: Array<{
    handlers: Map<string, Handler[]>;
    startLoads: Array<number | undefined>;
    levels: Array<{ details?: FakeLevelDetails }>;
    currentLevel: number;
    destroyed: boolean;
  }> = [];
  return { instances };
});

vi.mock('hls.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('hls.js')>();
  class FakeHls {
    static isSupported() {
      return true;
    }
    static DefaultConfig = actual.default.DefaultConfig;
    handlers = new Map<string, Handler[]>();
    startLoads: Array<number | undefined> = [];
    levels: Array<{ details?: FakeLevelDetails }> = [];
    currentLevel = -1;
    destroyed = false;
    constructor() {
      fakes.instances.push(this);
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
    destroy() {
      this.destroyed = true;
    }
  }
  return { ...actual, default: FakeHls };
});

vi.mock('../src/features/player/CustomManifestLoader', () => ({
  CustomManifestLoader: class {},
  CustomFragmentLoader: class {},
  manifestFetcher: {
    feedHealth: {
      subscribe: () => () => undefined,
      recordPlaybackStall: () => undefined,
    },
    registerLadder: () => undefined,
    unregisterLadder: () => undefined,
    watchLadderCompletion: () => () => undefined,
    followOnlyRung: () => undefined,
    attachPlayhead: () => () => undefined,
    markLiveSegmentGap: () => false,
    reportSegmentLoad: () => undefined,
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

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fakes.instances.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function emit(index: number, event: string, data: unknown = {}): void {
  const instance = fakes.instances[index];
  act(() => {
    for (const handler of instance.handlers.get(event) ?? []) {
      handler(event, data);
    }
  });
}

const FATAL_LEVEL_LOAD = { fatal: true, type: ErrorTypes.NETWORK_ERROR, details: ErrorDetails.LEVEL_LOAD_ERROR };
const FATAL_FRAGMENT_LOAD = { fatal: true, type: ErrorTypes.NETWORK_ERROR, details: ErrorDetails.FRAG_LOAD_ERROR };
const FATAL_FRAGMENT_TIMEOUT = { fatal: true, type: ErrorTypes.NETWORK_ERROR, details: ErrorDetails.FRAG_LOAD_TIMEOUT };
const SEGMENT_S = 2;
const RECORDING_S = 2142;

/** A level's playlist of two second segments, as hls.js holds it once the level has loaded. */
function levelDetails(live: boolean): FakeLevelDetails {
  const fragments = Array.from({ length: RECORDING_S / SEGMENT_S }, (_, i) => ({
    start: i * SEGMENT_S,
    duration: SEGMENT_S,
  }));
  return { live, targetduration: SEGMENT_S, fragments };
}

function videoElement(): HTMLVideoElement {
  const video = container.querySelector('video');
  assert.ok(video);
  return video;
}

function playheadAt(positionS: number): void {
  Object.defineProperty(videoElement(), 'currentTime', { configurable: true, value: positionS });
}

/** Moves the playhead to `positionS` the way playing there does, which the media announces. */
function playTo(positionS: number): void {
  playheadAt(positionS);
  act(() => {
    videoElement().dispatchEvent(new Event('timeupdate'));
  });
}

/**
 * Fails player `index` fatally with the playhead at `positionS`.
 *
 * @param levelLoaded Whether that player had loaded its level, which is what it reads its place from.
 * @param error The fatal error, a playlist failure unless a test names a media one.
 */
function failPlayer(
  index: number,
  positionS: number,
  live: boolean,
  levelLoaded = true,
  error: object = FATAL_LEVEL_LOAD,
): void {
  const instance = fakes.instances[index];
  instance.levels = levelLoaded ? [{ details: levelDetails(live) }] : [{}];
  instance.currentLevel = 0;
  playheadAt(positionS);

  emit(index, Events.ERROR, error);
  assert.equal(instance.destroyed, true, `the fatal error did not restart player ${index}`);
  assert.equal(fakes.instances.length, index + 2, `no player was built after player ${index}`);
}

/**
 * Mounts the player, plays to `positionS` on a level that is or is not live, and fails it fatally.
 *
 * @param parseRebuilt Whether the rebuilt player then parses its manifest, which is when it starts loading.
 */
function failFatallyAt(positionS: number, live: boolean, parseRebuilt = true): void {
  act(() => {
    root.render(
      createElement(SwarmHlsPlayer, {
        owner: '0000000000000000000000000000000000000000',
        topicString: 'restart-position',
        mediaType: MEDIA_TYPE_VIDEO,
        autoPlay: false,
      }),
    );
  });
  emit(0, Events.MANIFEST_PARSED);
  failPlayer(0, positionS, live);
  if (parseRebuilt) {
    emit(1, Events.MANIFEST_PARSED);
  }
}

describe('a player restarted by a fatal error', () => {
  it('resumes a recording where the viewer was, not from the start', () => {
    failFatallyAt(2100, false);

    assert.deepEqual(fakes.instances[1].startLoads, [2100]);
  });

  // The rebuilt player holds no level yet, so what it reads as its own position is nothing, and that
  // nothing must not replace the place the viewer had.
  it('keeps the recording position through a second fatal error before the rebuilt player has started', () => {
    failFatallyAt(2100, false, false);

    emit(1, Events.ERROR, FATAL_LEVEL_LOAD);
    assert.equal(fakes.instances.length, 3, 'the second fatal error did not restart the player');
    emit(2, Events.MANIFEST_PARSED);

    assert.deepEqual(fakes.instances[2].startLoads, [2100]);
  });

  // The rebuilt player was asked to start at 2100 and failed before playback moved, so its own reading
  // says nothing, and the place it was asked to start at is still where the viewer is.
  it('keeps the recording position through a second fatal error after the rebuilt player has started loading', () => {
    failFatallyAt(2100, false);

    failPlayer(1, 0, false, false);
    emit(2, Events.MANIFEST_PARSED);

    assert.deepEqual(fakes.instances[2].startLoads, [2100]);
  });

  // A playlist that fails to load says nothing about the segment at the viewer's place, so moving past
  // that segment would skip recording nothing showed was broken.
  it('stays at the place its player started however often the playlist fails there', () => {
    failFatallyAt(2100, false);

    failPlayer(1, 2100, false);
    emit(2, Events.MANIFEST_PARSED);
    failPlayer(2, 0, false, false);
    emit(3, Events.MANIFEST_PARSED);

    assert.deepEqual(
      fakes.instances.slice(1).map((instance) => instance.startLoads),
      [[2100], [2100], [2100]],
    );
  });

  // A segment that never loads fails every player sent to it, so resuming at the same place again
  // would restart the recording there for as long as the tab stays open.
  it('moves a segment on each time a recording fails again at the place its player started', () => {
    failFatallyAt(2100, false);

    failPlayer(1, 2100, false, true, FATAL_FRAGMENT_LOAD);
    emit(2, Events.MANIFEST_PARSED);
    failPlayer(2, 2102, false, true, FATAL_FRAGMENT_LOAD);
    emit(3, Events.MANIFEST_PARSED);
    failPlayer(3, 0, false, false, FATAL_FRAGMENT_TIMEOUT);
    emit(4, Events.MANIFEST_PARSED);

    assert.deepEqual(
      fakes.instances.slice(1).map((instance) => instance.startLoads),
      [[2100], [2102], [2104], [2106]],
    );
  });

  it('resumes at the new place, not a segment on, once playback has moved past where the player started', () => {
    failFatallyAt(2100, false);

    playTo(2103);
    failPlayer(1, 2110, false, true, FATAL_FRAGMENT_LOAD);
    emit(2, Events.MANIFEST_PARSED);
    failPlayer(2, 2110, false, true, FATAL_FRAGMENT_LOAD);
    emit(3, Events.MANIFEST_PARSED);

    assert.deepEqual(
      fakes.instances.slice(1).map((instance) => instance.startLoads),
      [[2100], [2110], [2112]],
    );
  });

  it('rejoins a live broadcast at the live edge however often it fails', () => {
    failFatallyAt(2100, true);

    failPlayer(1, 2100, true);
    emit(2, Events.MANIFEST_PARSED);

    assert.deepEqual(fakes.instances[2].startLoads, [undefined]);
  });

  it('names the error that caused the restart in the line that announces it', () => {
    failFatallyAt(2100, false);

    const lines = vi.mocked(console.warn).mock.calls.map((call) => call.join(' '));
    const restart = lines.filter((line) => line.startsWith('Restarting stream'));
    assert.equal(restart.length, 1, `restart lines: ${restart.join(' | ')}`);
    assert.match(restart[0], new RegExp(ErrorDetails.LEVEL_LOAD_ERROR));
    assert.doesNotMatch(restart[0], /manifest parsing/);
  });

  it('rejoins a live broadcast at the live edge, as it always has', () => {
    failFatallyAt(2100, true);

    assert.deepEqual(fakes.instances[1].startLoads, [undefined]);
  });

  it('starts a recording the viewer had not started yet from the start', () => {
    failFatallyAt(0, false);

    assert.deepEqual(fakes.instances[1].startLoads, [undefined]);
  });
});
