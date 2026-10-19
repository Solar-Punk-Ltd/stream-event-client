/**
 * Which quality a source's own player plays: picked by the node's peer count, or a height the viewer holds. The rule
 * by peers is weeb-3's author's, from the package's HLS example page: the highest from 90 peers, and one height lower
 * below each of 90, 60 and 30.
 */
import type { PlayerLevel, PlayerQuality } from '@/swarm/provider';

export const BY_PEERS = 'by-peers';

/** By peers, or the height in pixels the viewer holds. */
export type QualityChoice = typeof BY_PEERS | number;

/** Below each of these peer counts the quality is one height lower. */
const PEER_LIMITS = [90, 60, 30] as const;

/** One level per height a stream has, the higher bitrate where two share one, highest first. */
export function qualitySteps(levels: readonly PlayerLevel[]): PlayerLevel[] {
  const byHeight = new Map<number, PlayerLevel>();
  for (const level of levels) {
    const kept = byHeight.get(level.height);
    if (level.height > 0 && (kept === undefined || level.bitrate > kept.bitrate)) {
      byHeight.set(level.height, level);
    }
  }
  return [...byHeight.values()].sort((one, other) => other.height - one.height);
}

export function levelByPeers(steps: readonly PlayerLevel[], peers: number): PlayerLevel | null {
  const stepsDown = PEER_LIMITS.filter((limit) => peers < limit).length;
  return steps[Math.min(stepsDown, steps.length - 1)] ?? null;
}

/** The held height, else the nearest lower one the stream has, else its lowest. */
export function levelForHeight(steps: readonly PlayerLevel[], height: number): PlayerLevel | null {
  return steps.find((step) => step.height <= height) ?? steps.at(-1) ?? null;
}

/** weeb-3's level for "no quality plays yet", and for Auto as the selected one. */
export const NO_LEVEL = -1;

/**
 * The level to switch to now, or null. Nothing switches before a quality plays, nor while a switch has not taken
 * effect yet, nor to the height already playing.
 */
export function levelToHold(quality: PlayerQuality, choice: QualityChoice, peers: number): number | null {
  const { levels, selectedLevel, currentLevel } = quality;
  if (currentLevel === NO_LEVEL || (selectedLevel !== NO_LEVEL && selectedLevel !== currentLevel)) {
    return null;
  }
  const steps = qualitySteps(levels);
  const target = choice === BY_PEERS ? levelByPeers(steps, peers) : levelForHeight(steps, choice);
  const playing = levels.find(({ level }) => level === currentLevel);
  return target !== null && target.height !== playing?.height ? target.level : null;
}
