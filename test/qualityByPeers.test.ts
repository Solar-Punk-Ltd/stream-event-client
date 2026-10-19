import { describe, expect, it } from 'vitest';

import {
  BY_PEERS,
  levelByPeers,
  levelForHeight,
  levelToHold,
  qualitySteps,
} from '../src/features/player/qualityByPeers';
import type { PlayerLevel, PlayerQuality } from '../src/swarm/provider';

const LEVELS: readonly PlayerLevel[] = [
  { level: 0, height: 360, bitrate: 800_000 },
  { level: 1, height: 720, bitrate: 2_500_000 },
  { level: 2, height: 1080, bitrate: 5_000_000 },
  { level: 3, height: 480, bitrate: 1_200_000 },
];

const quality = (selectedLevel: number, currentLevel: number, levels = LEVELS): PlayerQuality => ({
  levels,
  selectedLevel,
  currentLevel,
});

const heights = (levels: readonly PlayerLevel[]) => levels.map(({ height }) => height);

describe('the quality steps', () => {
  it('are one level per height, highest first', () => {
    expect(heights(qualitySteps(LEVELS))).toEqual([1080, 720, 480, 360]);
  });

  it('keep the higher bitrate of two levels at one height, and leave out a level with no height', () => {
    const steps = qualitySteps([
      { level: 0, height: 720, bitrate: 2_000_000 },
      { level: 1, height: 720, bitrate: 3_000_000 },
      { level: 2, height: 0, bitrate: 64_000 },
    ]);

    expect(steps).toEqual([{ level: 1, height: 720, bitrate: 3_000_000 }]);
  });
});

describe('by peers', () => {
  const steps = qualitySteps(LEVELS);
  const heightFor = (peers: number) => levelByPeers(steps, peers)?.height;

  it('plays the highest from 90 peers, and one step lower below 90, 60 and 30', () => {
    expect(heightFor(200)).toBe(1080);
    expect(heightFor(90)).toBe(1080);
    expect(heightFor(89)).toBe(720);
    expect(heightFor(60)).toBe(720);
    expect(heightFor(59)).toBe(480);
    expect(heightFor(30)).toBe(480);
    expect(heightFor(29)).toBe(360);
    expect(heightFor(0)).toBe(360);
  });

  it('stays on the lowest a stream has when the peers ask for a lower one', () => {
    const two = qualitySteps(LEVELS.filter(({ height }) => height >= 720));

    expect(levelByPeers(two, 10)?.height).toBe(720);
  });

  it('has nothing to pick before the qualities are known', () => {
    expect(levelByPeers([], 100)).toBeNull();
  });
});

describe('a held height', () => {
  const steps = qualitySteps(LEVELS);

  it('is that height when the stream has it, else the nearest lower, else the lowest', () => {
    expect(levelForHeight(steps, 720)?.level).toBe(1);
    expect(levelForHeight(steps, 600)?.height).toBe(480);
    expect(levelForHeight(steps, 240)?.height).toBe(360);
  });
});

describe('the level to switch to', () => {
  it('is the one the peers ask for when another height plays', () => {
    expect(levelToHold(quality(2, 2), BY_PEERS, 40)).toBe(3);
  });

  it('is nothing while the height the peers ask for plays', () => {
    expect(levelToHold(quality(3, 3), BY_PEERS, 40)).toBeNull();
  });

  it('is nothing while an earlier switch has not taken effect', () => {
    expect(levelToHold(quality(1, 2), BY_PEERS, 10)).toBeNull();
  });

  it('is nothing before anything plays, since the first pick is still taking effect', () => {
    expect(levelToHold(quality(2, -1), BY_PEERS, 10)).toBeNull();
  });

  it('is the held height whatever the peers', () => {
    expect(levelToHold(quality(2, 2), 360, 200)).toBe(0);
    expect(levelToHold(quality(0, 0), 360, 200)).toBeNull();
  });

  it('is nothing for a stream with no qualities to pick from', () => {
    expect(levelToHold(quality(-1, -1, []), BY_PEERS, 10)).toBeNull();
  });
});
