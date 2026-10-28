// @vitest-environment jsdom
import Hls, { Events, type LevelDetails } from 'hls.js';
import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';

import { CustomManifestLoader, manifestFetcher } from '../src/features/player/CustomManifestLoader';
import { buildPlayerConfig, LIVE_SYNC_DURATION_S } from '../src/features/player/playerConfig';
import { buildMasterPlaylist, buildSwarmUri } from '../src/features/player/playlist';
import { attachActiveRungFollower } from '../src/features/player/rungHealth';

/**
 * Where hls.js places a quality's playlist after the player forgot it, run through the real hls.js with the player's
 * own playlist loader.
 *
 * hls.js places a playlist it loads for a quality holding none against the playlist it loaded last. When the player
 * has forgotten that one, the new playlist starts at 0, and hls.js moves a stalled video to its live edge less the
 * live target, about 50 s into a 64 s playlist, however far the broadcast is past that.
 */

const OWNER = 'aabbccddeeff00112233445566778899aabbccdd';
const RUNGS = [
  { name: 'return-480p', height: 480, bandwidth: 1_400_000 },
  { name: 'return-720p', height: 720, bandwidth: 2_800_000 },
] as const;
const ON_SCREEN = 0;
const LEFT = 1;
const SOURCE = buildSwarmUri(OWNER, 'return-group');
const SEGMENT_S = 2;
/** Segments in each playlist, the uploader's window of about 64 s. */
const WINDOW = 32;
const BROADCAST_START_MS = Date.UTC(2026, 9, 28, 12, 0, 0);

/** The live playlist of one quality when its newest segment is `newest`, each segment stamped with its date. */
function livePlaylist(name: string, newest: number): string {
  const first = newest - WINDOW + 1;
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${SEGMENT_S}`, `#EXT-X-MEDIA-SEQUENCE:${first}`];
  for (let sequence = first; sequence <= newest; sequence++) {
    lines.push(
      `#EXT-X-PROGRAM-DATE-TIME:${new Date(BROADCAST_START_MS + sequence * SEGMENT_S * 1000).toISOString()}`,
      `#EXTINF:${SEGMENT_S}.0,`,
      `https://gateway.example.com/${name}/${sequence}.ts`,
    );
  }
  return `${lines.join('\n')}\n`;
}

let hls: Hls | null = null;

afterEach(() => {
  hls?.destroy();
  hls = null;
  vi.restoreAllMocks();
});

/** The next playlist hls.js loads for `level`, once it has been placed. */
function nextLoadOf(player: Hls, level: number): Promise<LevelDetails> {
  return new Promise((resolve) => {
    const onLoaded = (_event: unknown, data: { level: number; details: LevelDetails }) => {
      if (data.level === level) {
        player.off(Events.LEVEL_LOADED, onLoaded);
        resolve(data.details);
      }
    };
    player.on(Events.LEVEL_LOADED, onLoaded);
  });
}

/**
 * A ladder of two qualities playing the lower one, with the player's follower attached, whose broadcast is at segment
 * `newest()` when each playlist is asked for. jsdom has no media, so the quality on screen is stated rather than
 * played.
 *
 * hls.js's clock stands still, as it nearly does over the moment the switches take. It is that clock hls.js reads
 * to decide whether the playlist on screen is due again, and how far its live edge has moved since it was loaded.
 */
async function playingTheLowerQuality(newest: () => number): Promise<Hls> {
  vi.spyOn(performance, 'now').mockReturnValue(1_000_000);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const renditions = RUNGS.map((rung) => ({
    name: rung.name,
    topic: rung.name,
    bandwidth: rung.bandwidth,
    avgBandwidth: rung.bandwidth,
    width: (rung.height * 16) / 9,
    height: rung.height,
  }));
  vi.spyOn(manifestFetcher, 'fetchSource').mockResolvedValue(buildMasterPlaylist(OWNER, renditions));
  vi.spyOn(manifestFetcher, 'fetch').mockImplementation(async (url: string) => {
    const rung = RUNGS.find((candidate) => url.endsWith(`/${candidate.name}`));
    assert.ok(rung, `a level request for ${url}, which is no rung of this ladder`);
    return livePlaylist(rung.name, newest());
  });

  const player = new Hls(buildPlayerConfig({ pLoader: CustomManifestLoader as never }));
  hls = player;
  Object.defineProperty(player, 'currentLevel', { configurable: true, get: () => ON_SCREEN });
  attachActiveRungFollower(player, () => undefined);

  const firstLoad = nextLoadOf(player, ON_SCREEN);
  player.on(Events.MANIFEST_PARSED, () => {
    player.startLevel = ON_SCREEN;
    player.startLoad();
  });
  player.loadSource(SOURCE);
  await firstLoad;
  return player;
}

describe('a quality hls.js moves to, leaves before it plays and asks for again', () => {
  it('is placed beside the quality on screen, so a stalled video is not sent back to the start of the timeline', async () => {
    let newest = 131;
    const player = await playingTheLowerQuality(() => newest);

    // A minute on, hls.js moves up and places the higher quality's playlist beside the one on screen, by date.
    newest = 161;
    const movedUp = nextLoadOf(player, LEFT);
    player.nextLoadLevel = LEFT;
    const placedBeside = (await movedUp).fragmentStart;
    assert.equal(Math.round(placedBeside), (161 - 131) * SEGMENT_S, 'the first placement of the higher quality');

    // It goes back to the quality on screen at once, as when a segment of the higher one fails, and asks for the
    // higher one again before the playlist of the one on screen is due again.
    const askedAgain = nextLoadOf(player, LEFT);
    player.nextLoadLevel = ON_SCREEN;
    player.nextLoadLevel = LEFT;
    const placedAgain = await askedAgain;

    assert.equal(
      Math.round(placedAgain.fragmentStart),
      Math.round(placedBeside),
      'the higher quality asked for again is placed apart from the one on screen',
    );
    // Where hls.js moves a stalled video: the live edge of the playlist it loaded last, less the live target, and later
    // by however long that playlist has been held.
    const stalledVideoMovedTo = player.liveSyncPosition ?? 0;
    assert.ok(
      stalledVideoMovedTo >= placedBeside + WINDOW * SEGMENT_S - LIVE_SYNC_DURATION_S,
      `hls.js would move a stalled video to ${stalledVideoMovedTo} s`,
    );
  });
});
