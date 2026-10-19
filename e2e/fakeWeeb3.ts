import type { Page } from '@playwright/test';

/** What the fake package's `postPushChunk` was handed, as hex, kept on the page for a journey to read. */
interface FakeWeeb3Push {
  readonly data: string;
  readonly soc: boolean;
  readonly address: string;
  readonly stamp: string;
}

/**
 * A fake of the weeb-3 package: a node with three peers, a player that marks the video it was handed so a journey can
 * see what was attached, with three qualities playing the highest until one is held, and the level held marked on the
 * video, and a push that keeps what it was handed in `window.weeb3Pushes` and answers success.
 */
export const FAKE_WEEB3 = `
const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
export default async function init() {}
export class Weeb3No103 {
  start() {}
  async connectionCount() { return 3; }
  async attachStream(media, owner, topic, start) { media.dataset.weeb3 = [owner, topic, start].join('/'); }
  streamQuality(media) {
    const level = Number(media.dataset.weeb3Quality ?? 2);
    return {
      levels: [
        { level: 0, width: 640, height: 360, bitrate: 800000 },
        { level: 1, width: 1280, height: 720, bitrate: 2500000 },
        { level: 2, width: 1920, height: 1080, bitrate: 5000000 },
      ],
      selectedLevel: level,
      currentLevel: level,
    };
  }
  setStreamQuality(media, level) { media.dataset.weeb3Quality = String(level); }
  async postPushChunk(data, soc, address, stamp) {
    (window.weeb3Pushes ??= []).push({ data: hex(data), soc, address: hex(address), stamp: hex(stamp) });
    return 'Upload result: success';
  }
  free() {}
}
`;

/** The same, with a module that fails to load, so the node never starts. */
export const FAILING_WEEB3 = FAKE_WEEB3.replace(
  'export default async function init() {}',
  "export default async function init() { throw new Error('the fake fails'); }",
);

/** The page is told a service worker controls it, which the real package's worker would, so the node can be ready. */
export async function claimServiceWorkerControl(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.serviceWorker, 'controller', { configurable: true, get: () => ({}) });
  });
}

/** The chunk the page loads the package from answers with `module`, and its WebAssembly module with a few bytes. */
export async function serveFakeWeeb3(page: Page, module: string): Promise<void> {
  await page.route(/\/assets\/weeb_3-[^/]+\.js$/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: module }),
  );
  await page.route(/\/weeb-3\/weeb_3_bg\.wasm$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/wasm', body: Buffer.alloc(64) }),
  );
}

/** What the fake package has pushed so far. */
export function weeb3Pushes(page: Page): Promise<FakeWeeb3Push[]> {
  return page.evaluate(() => (window as unknown as { weeb3Pushes?: FakeWeeb3Push[] }).weeb3Pushes ?? []);
}
