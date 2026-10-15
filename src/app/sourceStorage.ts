/**
 * Where a viewer's sources and routing survive a reload: this browser's localStorage, one key each. A
 * refused storage means the deployment's defaults for this visit rather than a page that fails.
 */
import { type BrowserStorage, browserStorage, readStored, writeStored } from './browserStorage';
import { defaultRouting, parseRouting, type Routing, serializeRouting } from '@/swarm/routing';
import type { SwarmSettings } from '@/swarm/settings';
import { type AddedSource, parseAddedSources, serializeAddedSources } from '@/swarm/sources';

export const SOURCE_STORAGE_KEYS = {
  sources: 'swarm-sources',
  routing: 'swarm-routing',
} as const;

export interface SourceChoices {
  readonly added: readonly AddedSource[];
  readonly routing: Routing;
}

/** What the viewer chose before, or the deployment's defaults where nothing was saved. */
export function loadSourceChoices(
  settings: SwarmSettings,
  storage: BrowserStorage | null = browserStorage(),
): SourceChoices {
  return {
    added: parseAddedSources(readStored(storage, SOURCE_STORAGE_KEYS.sources)),
    routing: parseRouting(readStored(storage, SOURCE_STORAGE_KEYS.routing), defaultRouting(settings.defaultId)),
  };
}

export function saveAddedSources(added: readonly AddedSource[], storage = browserStorage()): void {
  writeStored(storage, SOURCE_STORAGE_KEYS.sources, serializeAddedSources(added));
}

export function saveRouting(routing: Routing, storage = browserStorage()): void {
  writeStored(storage, SOURCE_STORAGE_KEYS.routing, serializeRouting(routing));
}
