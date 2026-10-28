// @vitest-environment jsdom
import { Topic } from '@ethersphere/bee-js';
import Hls, { type ErrorData, Events } from 'hls.js';
import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';

import { CustomManifestLoader, manifestFetcher } from '../src/features/player/CustomManifestLoader';
import { RungNotReadyError, RungRefusedError } from '../src/features/player/ManifestManagement';
import { buildPlayerConfig } from '../src/features/player/playerConfig';
import { buildMasterPlaylist, buildSwarmUri } from '../src/features/player/playlist';
import { attachRungFailover } from '../src/features/player/rungHealth';

/**
 * A rung the poller refuses at a switch, run through the real hls.js with the player's own playlist
 * loader. Seen live on 2026-10-15: the poller refused 1080p, the player took its level out, and the
 * refused level request then reached hls.js as a load error naming the level's old number. That number
 * had gone with the removal, so hls.js found no level to switch to, called the error fatal, and the
 * player restarted the recording from 0.
 */

const OWNER = 'aabbccddeeff00112233445566778899aabbccdd';
const RUNGS = [
  { name: 'drop-360p', height: 360, bandwidth: 700_000 },
  { name: 'drop-720p', height: 720, bandwidth: 2_800_000 },
  { name: 'drop-1080p', height: 1080, bandwidth: 5_000_000 },
] as const;
const TOP = RUNGS[RUNGS.length - 1];
const hexOf = (name: string): string => Topic.fromString(name).toString();
const SOURCE = buildSwarmUri(OWNER, 'drop-group');

function mediaPlaylist(name: string, finished: boolean): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:2', '#EXT-X-MEDIA-SEQUENCE:0'];
  if (finished) {
    lines.push('#EXT-X-PLAYLIST-TYPE:VOD');
  }
  for (let i = 0; i < 10; i++) {
    lines.push('#EXTINF:2.0,', `https://gateway.example.com/${name}/${i}.ts`);
  }
  if (finished) {
    lines.push('#EXT-X-ENDLIST');
  }
  return lines.join('\n') + '\n';
}

let hls: Hls | null = null;

afterEach(() => {
  hls?.destroy();
  hls = null;
  vi.restoreAllMocks();
});

/** What the poller and `ManifestFetcher.fetch` do with a rung refused at a switch. */
function refusedAtASwitch(): never {
  manifestFetcher.feedHealth.recordRungStopped(hexOf(TOP.name), {
    reason: "its newest segment is 496s behind the playing quality's",
    failoverTo: hexOf(RUNGS[0].name),
  });
  throw new RungRefusedError(hexOf(TOP.name));
}

/** What `ManifestFetcher.fetch` does with a rung that produced no playlist before its deadline. */
function notReadyInTime(): never {
  const takenOut = manifestFetcher.feedHealth.recordRungStopped(hexOf(TOP.name), {
    reason: 'no playlist in 20000 ms',
    failoverTo: null,
  });
  throw new RungNotReadyError(hexOf(TOP.name), 20_000, takenOut);
}

/**
 * Plays the ladder from its top rung while that rung is refused. The mocked fetch stands in for two parts
 * of the real code: the poller, which announces the rung stopped through `feedHealth.recordRungStopped`
 * and so takes its level out, and `ManifestFetcher.fetch`, which then ends the request with
 * `RungRefusedError`.
 */
async function playWhileTopIsRefused(
  finished: boolean,
  refuseTop: () => never = refusedAtASwitch,
): Promise<{ errors: ErrorData[]; levels: number[] }> {
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
    if (rung === TOP) {
      refuseTop();
    }
    return mediaPlaylist(rung.name, finished);
  });

  const player = new Hls(buildPlayerConfig({ pLoader: CustomManifestLoader as never }));
  hls = player;
  const errors: ErrorData[] = [];
  const levels: number[] = [];
  player.on(Events.ERROR, (_event, data) => errors.push(data));
  player.on(Events.LEVEL_LOADED, (_event, data) => levels.push(player.levels[data.level]?.height ?? -1));
  const detach = attachRungFailover(player, manifestFetcher.feedHealth);

  await new Promise<void>((resolve) => {
    player.on(Events.MANIFEST_PARSED, () => {
      player.startLevel = RUNGS.length - 1;
      player.startLoad();
      resolve();
    });
    player.loadSource(SOURCE);
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  detach();
  return { errors, levels };
}

describe('a rung refused at a switch is taken out without stopping the player', () => {
  it('raises no fatal error on a finished recording, and carries on with a rung that is left', async () => {
    const { errors, levels } = await playWhileTopIsRefused(true);

    assert.deepEqual(
      errors.filter((error) => error.fatal).map((error) => error.details),
      [],
      'a fatal error is what restarts the player from the start',
    );
    assert.equal(hls?.levels.length, RUNGS.length - 1, 'the refused rung was not taken out');
    assert.ok(levels.length > 0 && !levels.includes(TOP.height), `levels loaded: ${levels.join(', ')}`);
  });

  it('raises no fatal error on a live broadcast either, and carries on with a rung that is left', async () => {
    const { errors, levels } = await playWhileTopIsRefused(false);

    assert.deepEqual(
      errors.filter((error) => error.fatal).map((error) => error.details),
      [],
    );
    assert.equal(hls?.levels.length, RUNGS.length - 1, 'the refused rung was not taken out');
    assert.ok(levels.length > 0 && !levels.includes(TOP.height), `levels loaded: ${levels.join(', ')}`);
  });
});

describe('a rung that produced no playlist in time is taken out the same way', () => {
  it('raises no fatal error, carries on with a rung that is left, and leaves no level for the penalty to bring back', async () => {
    const { errors, levels } = await playWhileTopIsRefused(false, notReadyInTime);

    assert.deepEqual(
      errors.filter((error) => error.fatal).map((error) => error.details),
      [],
    );
    assert.equal(hls?.levels.length, RUNGS.length - 1, 'the rung with no playlist was not taken out');
    assert.ok(levels.length > 0 && !levels.includes(TOP.height), `levels loaded: ${levels.join(', ')}`);
  });
});

const MID_PLAY_RUNGS = [
  { name: 'mid-360p', height: 360, bandwidth: 700_000 },
  { name: 'mid-480p', height: 480, bandwidth: 1_200_000 },
  { name: 'mid-720p', height: 720, bandwidth: 2_800_000 },
  { name: 'mid-1080p', height: 1080, bandwidth: 5_000_000 },
] as const;

function livePlaylist(name: string, firstSequence: number): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:2', `#EXT-X-MEDIA-SEQUENCE:${firstSequence}`];
  for (let i = 0; i < 10; i++) {
    const sequence = firstSequence + i;
    lines.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(Date.UTC(2026, 9, 28, 10) + sequence * 2000).toISOString()}`);
    lines.push('#EXTINF:2.0,', `https://gateway.example.com/${name}/${sequence}.ts`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Plays `playing`, switches to `switchTo`, whose playlist never comes, and then does what `ManifestFetcher.fetch`
 * does at the deadline. Answers the rung hls.js loads next and whether the playing rung kept its playlist.
 */
async function switchToARungThatNeverAnswers(
  playing: number,
  switchTo: number,
  bandwidth: number,
): Promise<{ nextHeight: number | undefined; playingKeptItsPlaylist: boolean }> {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const renditions = MID_PLAY_RUNGS.map((rung) => ({
    name: rung.name,
    topic: rung.name,
    bandwidth: rung.bandwidth,
    avgBandwidth: rung.bandwidth,
    width: Math.round((rung.height * 16) / 9),
    height: rung.height,
  }));
  const silent = MID_PLAY_RUNGS[switchTo];
  let failSilent: (reason: unknown) => void = () => {};
  let sequence = 300;
  vi.spyOn(manifestFetcher, 'fetchSource').mockResolvedValue(buildMasterPlaylist(OWNER, renditions));
  vi.spyOn(manifestFetcher, 'fetch').mockImplementation((url: string) => {
    const rung = MID_PLAY_RUNGS.find((candidate) => url.endsWith(`/${candidate.name}`));
    assert.ok(rung, `a level request for ${url}, which is no rung of this ladder`);
    if (rung === silent) {
      return new Promise<string>((_resolve, reject) => {
        failSilent = reject;
      });
    }
    sequence += 1;
    return Promise.resolve(livePlaylist(rung.name, sequence));
  });

  const player = new Hls(buildPlayerConfig({ pLoader: CustomManifestLoader as never }));
  hls = player;
  const detach = attachRungFailover(player, manifestFetcher.feedHealth);
  await new Promise<void>((resolve) => {
    player.on(Events.MANIFEST_PARSED, () => {
      player.startLevel = MID_PLAY_RUNGS.length - 1;
      player.startLoad();
      resolve();
    });
    player.loadSource(buildSwarmUri(OWNER, 'mid-group'));
  });
  player.nextLoadLevel = playing;
  await new Promise((resolve) => setTimeout(resolve, 30));
  // Past the start: jsdom plays no media, so the stream controller is told what a playing viewer's would hold, and
  // which rung is on screen.
  const streamController = (player as unknown as { streamController: Record<string, unknown> }).streamController;
  streamController._hasEnoughToStart = true;
  streamController.fragPlaying = { level: playing };
  player.bandwidthEstimate = bandwidth;

  player.nextLoadLevel = switchTo;
  await new Promise((resolve) => setTimeout(resolve, 30));
  // Waiting on a playlist that never comes, hls.js has no fragment of the new level requested yet.
  streamController.startFragRequested = false;

  const takenOut = manifestFetcher.feedHealth.recordRungStopped(hexOf(silent.name), {
    reason: 'no playlist in 20000 ms',
    failoverTo: null,
  });
  const nextHeight = player.levels[player.loadLevel]?.height;
  const playingKeptItsPlaylist = Boolean(
    player.levels.find((level) => level.height === MID_PLAY_RUNGS[playing].height)?.details,
  );
  failSilent(new RungNotReadyError(hexOf(silent.name), 20_000, takenOut));
  await new Promise((resolve) => setTimeout(resolve, 50));
  detach();
  return { nextHeight, playingKeptItsPlaylist };
}

describe('a rung with no playlist, taken out while hls.js was switching to it mid-play', () => {
  it('sends a viewer switching down back to the rung on screen, not to the start level', async () => {
    const { nextHeight, playingKeptItsPlaylist } = await switchToARungThatNeverAnswers(2, 1, 900_000);

    assert.equal(nextHeight, 720);
    assert.ok(playingKeptItsPlaylist, 'the playing rung kept the playlist its next reload aligns to');
  });

  it('sends a viewer switching up back to the rung on screen, with its playlist kept', async () => {
    const { nextHeight, playingKeptItsPlaylist } = await switchToARungThatNeverAnswers(2, 3, 20_000_000);

    assert.equal(nextHeight, 720);
    assert.ok(playingKeptItsPlaylist, 'the playing rung kept the playlist its next reload aligns to');
  });
});
