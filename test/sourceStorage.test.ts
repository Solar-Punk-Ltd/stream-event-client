import { describe, expect, it } from 'vitest';

import { loadSourceChoices, saveAddedSources, saveRouting, SOURCE_STORAGE_KEYS } from '../src/app/sourceStorage';
import { parseRuntimeConfig } from '../src/config/runtimeConfig';
import { defaultRouting, setMode } from '../src/swarm/routing';
import { swarmSettingsFrom } from '../src/swarm/settings';

const EVENT = 'https://event.example.com';
const BACKUP = 'https://backup.example.com';

function settings() {
  const result = parseRuntimeConfig({
    catalog: { owner: '0x' + '1'.repeat(40), topic: 'event-streams' },
    providers: {
      gateways: [
        { id: 'event', kind: 'bee-http', url: EVENT },
        { id: 'backup', kind: 'bee-http', url: BACKUP },
      ],
      default: 'event',
    },
  });
  if (!result.ok) {
    throw new Error(result.problem);
  }
  return swarmSettingsFrom(result.config);
}

/** A browser's storage in memory. */
function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

/** A browser that refuses the page its storage, as a private window or blocked site data can. */
const refusing = {
  getItem: (): string | null => {
    throw new DOMException('denied', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
  removeItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
};

describe("the viewer's sources in the browser", () => {
  it('are none added and the default routing when nothing is saved', () => {
    expect(loadSourceChoices(settings(), memory())).toEqual({ added: [], routing: defaultRouting('event') });
  });

  it('are what was saved under each key', () => {
    const storage = memory();
    const node = { id: 'added-1', type: 'bee-node' as const, name: 'Desk node', url: 'http://localhost:1633' };
    const routing = setMode(defaultRouting('event'), 'per-part');
    saveAddedSources([node], storage);
    saveRouting(routing, storage);

    expect([...storage.values.keys()].sort()).toEqual(
      [SOURCE_STORAGE_KEYS.sources, SOURCE_STORAGE_KEYS.routing].sort(),
    );
    expect(loadSourceChoices(settings(), storage)).toEqual({ added: [node], routing });
  });

  it('are the defaults, and saving does nothing, when the browser refuses its storage', () => {
    expect(loadSourceChoices(settings(), refusing)).toEqual({ added: [], routing: defaultRouting('event') });
    expect(() => saveRouting(defaultRouting('event'), refusing)).not.toThrow();
    expect(() => saveAddedSources([], refusing)).not.toThrow();
  });
});
