/**
 * The quality a viewer picked for a source's own player, kept in this browser so the next stream starts at it. A
 * height rather than a level, since each stream numbers its levels its own way.
 */
import { type BrowserStorage, browserStorage, readStored, writeStored } from '@/app/browserStorage';

import { BY_PEERS, type QualityChoice } from './qualityByPeers';

const QUALITY_CHOICE_STORAGE_KEY = 'stream-event-client:own-player-quality';

export function loadQualityChoice(storage: BrowserStorage | null = browserStorage()): QualityChoice {
  const saved = readStored(storage, QUALITY_CHOICE_STORAGE_KEY);
  const height = Number(saved);
  return saved !== null && Number.isInteger(height) && height > 0 ? height : BY_PEERS;
}

export function saveQualityChoice(choice: QualityChoice, storage: BrowserStorage | null = browserStorage()): void {
  writeStored(storage, QUALITY_CHOICE_STORAGE_KEY, String(choice));
}
