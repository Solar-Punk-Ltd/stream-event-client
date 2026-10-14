/**
 * Where a viewer's sources and routing survive a reload: this browser's localStorage, one key each. A
 * refused storage means the deployment's defaults for this visit rather than a page that fails.
 */
import { type BrowserStorage, browserStorage, readStored, removeStored, writeStored } from './browserStorage';
import { defaultRouting, parseRouting, type Routing, serializeRouting, chooseSource } from '@/swarm/routing';
import type { SwarmSettings } from '@/swarm/settings';
import { type AddedSource, migratedSources, parseAddedSources, serializeAddedSources } from '@/swarm/sources';

export const SOURCE_STORAGE_KEYS = {
  sources: 'swarm-sources',
  routing: 'swarm-routing',
  /** The one address the node picker and the control panel saved, read once to move it into a source. */
  legacyAddress: 'swarm-gateway-url',
} as const;

export interface SourceChoices {
  readonly added: readonly AddedSource[];
  readonly routing: Routing;
}

/**
 * What the viewer chose before. A browser holding only the address saved before sources existed has it
 * moved into a source once: its sources and routing are written under the new keys and the old key is
 * removed, so the move is not made again over a choice made since.
 */
export function loadSourceChoices(
  settings: SwarmSettings,
  storage: BrowserStorage | null = browserStorage(),
): SourceChoices {
  const initial = defaultRouting(settings.defaultId);
  const savedSources = readStored(storage, SOURCE_STORAGE_KEYS.sources);
  const savedRouting = readStored(storage, SOURCE_STORAGE_KEYS.routing);

  if (savedSources === null && savedRouting === null) {
    const migrated = migratedSources(settings, readStored(storage, SOURCE_STORAGE_KEYS.legacyAddress));
    if (migrated !== null) {
      const routing = chooseSource(initial, migrated.chosenId);
      saveAddedSources(migrated.added, storage);
      saveRouting(routing, storage);
      removeStored(storage, SOURCE_STORAGE_KEYS.legacyAddress);
      return { added: migrated.added, routing };
    }
  }
  return {
    added: parseAddedSources(savedSources),
    routing: parseRouting(savedRouting, initial),
  };
}

export function saveAddedSources(added: readonly AddedSource[], storage = browserStorage()): void {
  writeStored(storage, SOURCE_STORAGE_KEYS.sources, serializeAddedSources(added));
}

export function saveRouting(routing: Routing, storage = browserStorage()): void {
  writeStored(storage, SOURCE_STORAGE_KEYS.routing, serializeRouting(routing));
}
