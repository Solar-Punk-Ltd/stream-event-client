import Hls, {
  AbrController,
  ErrorController,
  ErrorDetails,
  ErrorTypes,
  NetworkErrorAction,
  PlaylistLevelType,
} from 'hls.js';
import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

import { barLevelOfFailedSegment, clearOtherLevelsFragmentErrors } from '../src/features/player/levelErrors';
import { buildPlayerConfig } from '../src/features/player/playerConfig';

(globalThis as { self?: unknown }).self ??= globalThis;

const QUIET = { trace() {}, debug() {}, log() {}, warn() {}, info() {}, error() {} };
const TOP = 3;

interface FakeLevel {
  fragmentError: number;
  loadError: number;
  loadErrorTime: number;
}

/**
 * What hls.js's error controller and ABR read of the player, with the shipped config and four levels of a live stream
 * playing the top one.
 */
function fourLevelPlayer() {
  const levels = Array.from({ length: 4 }, (_, index) => ({
    fragmentError: 0,
    loadError: 0,
    loadErrorTime: 0,
    audioCodec: 'mp4a.40.2',
    codecSet: 'avc1,mp4a',
    videoRange: 'SDR',
    bitrate: (index + 1) * 1_000_000,
    maxBitrate: (index + 1) * 1_000_000,
    averageBitrate: (index + 1) * 1_000_000,
    hasAudioGroup: () => false,
    hasSubtitleGroup: () => false,
  }));
  return {
    logger: QUIET,
    config: { ...Hls.DefaultConfig, ...buildPlayerConfig({ pLoader: undefined, fLoader: undefined }) },
    levels: levels as (FakeLevel & (typeof levels)[number])[],
    allAudioTracks: [],
    latestLevelDetails: { live: true },
    loadLevel: TOP,
    autoLevelEnabled: true,
    minAutoLevel: 0,
    maxAutoLevel: levels.length - 1,
    on() {},
    off() {},
  };
}

/** A main segment of `level` that failed with `code`, as hls.js reports it. */
function failed(level: number, code: number) {
  return {
    type: ErrorTypes.NETWORK_ERROR,
    details: ErrorDetails.FRAG_LOAD_ERROR,
    fatal: false,
    frag: { type: PlaylistLevelType.MAIN, level, sn: 10 },
    response: { code, text: String(code), url: 'https://gateway.example.com/bytes/segment' },
  };
}

/** What hls.js decides for a failed segment: retry, after how long, or move to another level. */
function decide(controller: ErrorController, error: ReturnType<typeof failed>) {
  const action = (
    controller as unknown as {
      getFragRetryOrSwitchAction(data: unknown): {
        action: NetworkErrorAction;
        retryCount: number;
        retryConfig: { retryDelayMs: number; maxRetryDelayMs: number };
      };
    }
  ).getFragRetryOrSwitchAction(error);
  const delayMs = Math.min(
    2 ** action.retryCount * action.retryConfig.retryDelayMs,
    action.retryConfig.maxRetryDelayMs,
  );
  return { action: action.action, delayMs };
}

/** A player that gave up one segment on the top level, three 404s, and stepped down to the next. */
function steppedDownOnce() {
  const hls = fourLevelPlayer();
  const controller = new ErrorController(hls as unknown as Hls);
  for (let ask = 0; ask < 3; ask++) {
    decide(controller, failed(TOP, 404));
  }
  hls.loadLevel = TOP - 1;
  return { hls, controller };
}

describe('the level error counts left by a segment given up on', () => {
  it("cost the next level its 404 retry and stretch its 5xx wait, until a segment buffers (hls.js's own behaviour)", () => {
    const { controller } = steppedDownOnce();

    assert.equal(decide(controller, failed(TOP - 1, 404)).action, NetworkErrorAction.SendAlternateToPenaltyBox);
  });

  it('are cleared on every other level once a main segment buffers, so the next level retries a 404 after 1 s', () => {
    const { hls, controller } = steppedDownOnce();

    clearOtherLevelsFragmentErrors(hls, { frag: { type: PlaylistLevelType.MAIN, level: TOP - 1 } as never });

    assert.deepEqual(decide(controller, failed(TOP - 1, 404)), {
      action: NetworkErrorAction.RetryRequest,
      delayMs: 1000,
    });
    assert.equal(decide(controller, failed(TOP - 1, 500)).delayMs, 2000);
  });

  it('leave the level stepped down from barred, which is what the penalty lifts', () => {
    const { hls } = steppedDownOnce();

    clearOtherLevelsFragmentErrors(hls, { frag: { type: PlaylistLevelType.MAIN, level: TOP - 1 } as never });

    assert.equal(hls.levels[TOP].fragmentError, 0);
    assert.equal(hls.levels[TOP].loadError, 1);
  });

  it('are left alone when an audio or subtitle segment buffers', () => {
    const { hls } = steppedDownOnce();

    clearOtherLevelsFragmentErrors(hls, { frag: { type: PlaylistLevelType.AUDIO, level: 0 } as never });

    assert.equal(hls.levels[TOP].fragmentError, 3);
  });
});

/**
 * The level hls.js's own ABR would move to next, with bandwidth for every level and a full buffer, after a segment of
 * `playing` was the last one loaded.
 */
function nextLevelChosen(hls: ReturnType<typeof fourLevelPlayer>, playing: number): number {
  const abr = new AbrController(hls as unknown as Hls) as unknown as {
    lastLoadedFragLevel: number;
    findBestLevel(
      bandwidth: number,
      minAutoLevel: number,
      maxAutoLevel: number,
      bufferStarvationDelayS: number,
      maxStarvationDelayS: number,
      bandwidthFactor: number,
      bandwidthUpFactor: number,
    ): number;
  };
  abr.lastLoadedFragLevel = playing;
  return abr.findBestLevel(1_000_000_000, 0, TOP, 30, 0, 1, 1);
}

/** The clock hls.js stamps and reads a level's penalty with, at `nowMs`. */
function clockAt(nowMs: number) {
  return vi.spyOn(performance, 'now').mockReturnValue(nowMs);
}

const PENALTY_MS = buildPlayerConfig({ pLoader: undefined, fLoader: undefined }).errorPenaltyExpireMs!;

describe('a quality whose segments fail while its playlist moves on', () => {
  /**
   * Back on the top level after its penalty lifted: hls.js loaded its playlist with no segment error on record, which
   * also cleared its load error (`onLevelLoaded` in its level controller), and asks for a segment while the level
   * below is still the one whose segment was loaded last.
   */
  function triedAgainAfterItsPenalty() {
    const hls = fourLevelPlayer();
    const controller = new ErrorController(hls as unknown as Hls);
    const error = failed(TOP, 404);
    const decision = decide(controller, error);
    barLevelOfFailedSegment(hls, error, performance.now());
    return { hls, decision };
  }

  it('stays out of the choice once a segment of the level below buffers, until its penalty has passed', () => {
    const clock = clockAt(1_000_000);
    try {
      const { hls, decision } = triedAgainAfterItsPenalty();
      assert.equal(decision.action, NetworkErrorAction.RetryRequest, 'hls.js decides the 404 as one to ask again');
      assert.equal(nextLevelChosen(hls, TOP - 1), TOP - 1, 'and its ABR leaves the level when the retry is due');

      clearOtherLevelsFragmentErrors(hls, { frag: { type: PlaylistLevelType.MAIN, level: TOP - 1 } as never });

      assert.equal(nextLevelChosen(hls, TOP - 1), TOP - 1, 'the failed level is chosen again at once');
      clock.mockReturnValue(1_000_000 + PENALTY_MS + 1);
      assert.equal(nextLevelChosen(hls, TOP - 1), TOP, 'the failed level is chosen again once its penalty has passed');
    } finally {
      clock.mockRestore();
    }
  });

  it('is still asked again when it is the level that plays, so a late segment keeps its quality', () => {
    const clock = clockAt(1_000_000);
    try {
      const { hls, decision } = triedAgainAfterItsPenalty();

      assert.equal(decision.action, NetworkErrorAction.RetryRequest);
      assert.equal(nextLevelChosen(hls, TOP), TOP);
    } finally {
      clock.mockRestore();
    }
  });

  it('is left alone for a fatal error, an audio segment or an error that is not a failed load', () => {
    const hls = fourLevelPlayer();
    const error = failed(TOP, 404);

    barLevelOfFailedSegment(hls, { ...error, fatal: true }, 1);
    barLevelOfFailedSegment(hls, { ...error, frag: { ...error.frag, type: PlaylistLevelType.AUDIO } } as never, 1);
    barLevelOfFailedSegment(hls, { ...error, details: ErrorDetails.FRAG_PARSING_ERROR }, 1);

    assert.deepEqual(
      hls.levels.map((level) => level.loadError),
      [0, 0, 0, 0],
    );
  });
});
