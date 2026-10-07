import type { Page } from '@playwright/test';

/** What the probe keeps on the page's window. */
interface ProbeWindow {
  __ladderProbe: {
    /** The newest hls.js player the page built. */
    hls: ProbedHls | null;
    /** How many players the page has built, so a restart shows. */
    created: number;
    switches: { level: number; uri: string; atMs: number }[];
    fatalErrors: { type: string; details: string; atMs: number }[];
    /** A level URI to switch to once the first fragment is buffered, and when that switch was asked. */
    switchAtFirstFragment: string | null;
    switchAskedAtMs: number | null;
  };
}

/** The part of an hls.js player the journeys drive and read. */
interface ProbedHls {
  levels: { uri: string; height: number }[];
  currentLevel: number;
  nextLevel: number;
  on(event: string, listener: (event: string, data: Record<string, unknown>) => void): void;
}

/**
 * Lets a journey reach the page's hls.js player without the app exposing it.
 *
 * hls.js gives the player no global, and the bundle keeps it in a closure. Its constructor assigns
 * `subtititleStreamController`, a misspelt field no other object carries, after its event emitter exists, so a
 * setter for that name on `Object.prototype` is handed every new player once and can subscribe to it. The setter
 * then defines the field on the player itself, so the player behaves exactly as it would without the probe.
 * hls.js names its events by these strings: `hlsLevelSwitched`, `hlsFragBuffered` and `hlsError`.
 */
export async function installHlsProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe: ProbeWindow['__ladderProbe'] = {
      hls: null,
      created: 0,
      switches: [],
      fatalErrors: [],
      switchAtFirstFragment: null,
      switchAskedAtMs: null,
    };
    (window as unknown as ProbeWindow).__ladderProbe = probe;
    // Extending the prototype is the point here, and only in the test's own page. See above.
    // oxlint-disable-next-line no-extend-native
    Object.defineProperty(Object.prototype, 'subtititleStreamController', {
      configurable: true,
      set(this: ProbedHls, value: unknown) {
        Object.defineProperty(this, 'subtititleStreamController', {
          value,
          writable: true,
          configurable: true,
          enumerable: true,
        });
        probe.hls = this;
        probe.created += 1;
        this.on('hlsLevelSwitched', (_event, data) => {
          const level = data.level as number;
          probe.switches.push({ level, uri: this.levels[level]?.uri ?? '', atMs: Date.now() });
        });
        this.on('hlsFragBuffered', () => {
          const index = this.levels.findIndex((level) => level.uri === probe.switchAtFirstFragment);
          if (index >= 0) {
            this.nextLevel = index;
            probe.switchAskedAtMs = Date.now();
          }
          probe.switchAtFirstFragment = null;
        });
        this.on('hlsError', (_event, data) => {
          if (data.fatal) {
            probe.fatalErrors.push({ type: String(data.type), details: String(data.details), atMs: Date.now() });
          }
        });
      },
    });
  });
}

/** The URI of the level hls.js is playing, `swarm://<owner>/<topic>`, or null before it plays one. */
export function playingUri(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const hls = (window as unknown as ProbeWindow).__ladderProbe.hls;
    return hls && hls.currentLevel >= 0 ? (hls.levels[hls.currentLevel]?.uri ?? null) : null;
  });
}

/** The URIs of the levels hls.js holds, in its order. */
export function levelUris(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__ladderProbe.hls?.levels.map((l) => l.uri) ?? []);
}

/** Asks hls.js to switch to the level with this URI at the next fragment, as `hls.nextLevel` does. */
export async function switchTo(page: Page, uri: string): Promise<void> {
  const found = await page.evaluate((target) => {
    const hls = (window as unknown as ProbeWindow).__ladderProbe.hls;
    const index = hls?.levels.findIndex((level) => level.uri === target) ?? -1;
    if (hls && index >= 0) {
      hls.nextLevel = index;
    }
    return index >= 0;
  }, uri);
  if (!found) {
    throw new Error(`hls.js holds no level ${uri}`);
  }
}

/**
 * Asks hls.js to switch to the level with this URI the moment its first fragment is buffered, which is before
 * hls.js reports the quality it started on. A journey sets it before opening the page.
 */
export async function switchAtFirstFragment(page: Page, uri: string): Promise<void> {
  await page.addInitScript((target) => {
    (window as unknown as ProbeWindow).__ladderProbe.switchAtFirstFragment = target;
  }, uri);
}

export function probeState(page: Page): Promise<Omit<ProbeWindow['__ladderProbe'], 'hls'>> {
  return page.evaluate(() => {
    const { hls: _hls, ...state } = (window as unknown as ProbeWindow).__ladderProbe;
    return state;
  });
}

export function videoTime(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelector('video')?.currentTime ?? 0);
}
