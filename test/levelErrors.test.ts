import Hls, { ErrorController, ErrorDetails, ErrorTypes, NetworkErrorAction, PlaylistLevelType } from 'hls.js';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { clearOtherLevelsFragmentErrors } from '../src/features/player/levelErrors';
import { buildPlayerConfig } from '../src/features/player/playerConfig';

(globalThis as { self?: unknown }).self ??= globalThis;

const QUIET = { trace() {}, debug() {}, log() {}, warn() {}, info() {}, error() {} };
const TOP = 3;

interface FakeLevel {
  fragmentError: number;
  loadError: number;
  loadErrorTime: number;
}

/** What hls.js's error controller reads of the player, with the shipped config and four levels playing the top one. */
function fourLevelPlayer() {
  const levels = Array.from({ length: 4 }, (_, index) => ({
    fragmentError: 0,
    loadError: 0,
    loadErrorTime: 0,
    audioCodec: 'mp4a.40.2',
    codecSet: 'avc1,mp4a',
    videoRange: 'SDR',
    bitrate: (index + 1) * 1_000_000,
    hasAudioGroup: () => false,
    hasSubtitleGroup: () => false,
  }));
  return {
    logger: QUIET,
    config: { ...Hls.DefaultConfig, ...buildPlayerConfig({ pLoader: undefined, fLoader: undefined }) },
    levels: levels as (FakeLevel & (typeof levels)[number])[],
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

describe('the player component', () => {
  it('clears them on every buffered segment', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/features/player/SwarmHlsPlayer.tsx', import.meta.url), 'utf8');

    assert.match(
      source,
      /Events\.FRAG_BUFFERED, \(_event, data\) => \{[^}]*clearOtherLevelsFragmentErrors\(hls, data\)/,
    );
  });
});
