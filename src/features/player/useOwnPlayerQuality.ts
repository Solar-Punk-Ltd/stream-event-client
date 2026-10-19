import { useCallback, useEffect, useRef, useState } from 'react';

import type { OwnPlayer, PlayerQuality } from '@/swarm/provider';

import { BY_PEERS, levelToHold, NO_LEVEL, type QualityChoice } from './qualityByPeers';
import { loadQualityChoice, saveQualityChoice } from './qualityChoice';

/** How often the playing quality is read for the line under the player, and a held height is checked. */
const QUALITY_READ_MS = 1_000;
/** How often By peers looks at the peer count again, as weeb-3's own example page does. */
const BY_PEERS_EVERY_MS = 5_000;

interface OwnPlayerQuality {
  /** The stream's qualities, or null until they have loaded or for a player that offers no choice. */
  readonly quality: PlayerQuality | null;
  readonly choice: QualityChoice;
  /** Keeps the choice in this browser and applies it at once. */
  readonly pick: (choice: QualityChoice) => void;
}

const sameQuality = (one: PlayerQuality | null, other: PlayerQuality | null) =>
  JSON.stringify(one) === JSON.stringify(other);

/**
 * Picks the quality a source's own player plays. By peers checks the node's peer count every 5 s while the video
 * plays, and once as soon as a quality plays. A held height is kept whenever the player strays from it. A switch the
 * player refuses, as during a seek, is tried again on a later check.
 */
export function useOwnPlayerQuality(
  player: OwnPlayer | null,
  video: HTMLVideoElement | null,
  peers: number,
): OwnPlayerQuality {
  const [quality, setQuality] = useState<PlayerQuality | null>(null);
  const [choice, setChoice] = useState<QualityChoice>(loadQualityChoice);
  const peersRef = useRef(peers);
  peersRef.current = peers;
  const choiceRef = useRef(choice);
  choiceRef.current = choice;
  const lastByPeersMs = useRef<number | null>(null);

  const check = useCallback(
    (force: boolean) => {
      const read = player?.quality?.() ?? null;
      setQuality((shown) => (sameQuality(shown, read) ? shown : read));
      if (read === null || player?.holdQuality === undefined) {
        return;
      }
      const current = choiceRef.current;
      if (current === BY_PEERS) {
        const now = Date.now();
        const isDue = force || lastByPeersMs.current === null || now - lastByPeersMs.current >= BY_PEERS_EVERY_MS;
        const isPlaying = video !== null && !video.paused && !video.ended && read.currentLevel !== NO_LEVEL;
        if (!isDue || !isPlaying) {
          return;
        }
        lastByPeersMs.current = now;
      }
      const level = levelToHold(read, current, peersRef.current);
      if (level === null) {
        return;
      }
      try {
        player.holdQuality(level);
      } catch {
        // The player cannot switch now, as during a seek back. By peers is due again at the next check, a second on.
        lastByPeersMs.current = null;
      }
    },
    [player, video],
  );

  useEffect(() => {
    setQuality(null);
    lastByPeersMs.current = null;
    if (player === null) {
      return;
    }
    check(false);
    const timer = setInterval(() => check(false), QUALITY_READ_MS);
    return () => clearInterval(timer);
  }, [player, check]);

  const pick = useCallback(
    (next: QualityChoice) => {
      saveQualityChoice(next);
      choiceRef.current = next;
      setChoice(next);
      check(true);
    },
    [check],
  );

  return { quality, choice, pick };
}
