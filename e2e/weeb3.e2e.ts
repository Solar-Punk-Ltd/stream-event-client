import { expect, test, type Page } from '@playwright/test';

import { refuseOtherOrigins, serveConfig } from './journey';
import { LadderGateway } from './ladderGateway';

/**
 * The node in this browser, weeb-3, against a fake of its package: the chunk the page loads it from is answered with a
 * module of the package's shape, and its WebAssembly module with a few bytes. The page is told a service worker
 * controls it, which the real package's worker would, so the node can be ready. Picked on the Sources screen, its row
 * shows how far the node has got, and on the watch page it plays bare in its own player once the node is ready. A node
 * that fails says so and nothing takes its place. The real package and the network are never reached.
 */

test.describe.configure({ timeout: 120_000 });

/** The fake package, which marks the video it was handed so the journey can see what was attached. */
const FAKE_WEEB3 = `
export default async function init() {}
export class Weeb3No103 {
  start() {}
  async connectionCount() { return 3; }
  async attachStream(media, owner, topic, start) { media.dataset.weeb3 = [owner, topic, start].join('/'); }
  free() {}
}
`;

/** The same, with a module that fails to load, so the node never starts. */
const FAILING_WEEB3 = FAKE_WEEB3.replace(
  'export default async function init() {}',
  "export default async function init() { throw new Error('the fake fails'); }",
);

async function claimServiceWorkerControl(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.serviceWorker, 'controller', { configurable: true, get: () => ({}) });
  });
}

async function serveFakeWeeb3(page: Page, module: string): Promise<void> {
  await page.route(/\/assets\/weeb_3-[^/]+\.js$/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: module }),
  );
  await page.route(/\/weeb-3\/weeb_3_bg\.wasm$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/wasm', body: Buffer.alloc(64) }),
  );
}

async function pickNodeInThisBrowser(page: Page, rowSays: string): Promise<void> {
  await page.getByRole('button', { name: /^Sources/ }).click();
  const screen = page.getByRole('dialog', { name: 'Sources' });
  await screen.getByRole('button', { name: 'Add source', exact: true }).click();
  await screen.getByRole('button', { name: /^Node in this browser/ }).click();
  await screen.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(
    screen.getByRole('radio', { name: 'Node in this browser' }),
    'it serves the video only, so it cannot be the one source',
  ).toBeDisabled();
  const row = screen.locator('[data-source-row]', { hasText: 'Node in this browser' });
  await expect(row.getByRole('status'), 'the row says how far the node has got').toHaveText(rowSays, {
    timeout: 20_000,
  });
  await screen.locator('label.sources-mode', { hasText: 'Per part' }).click();
  await screen.getByLabel('Video', { exact: true }).selectOption({ label: 'Node in this browser' });
  await screen.getByRole('button', { name: 'Done', exact: true }).click();
}

async function openWatchPage(page: Page, gateway: LadderGateway, module: string, rowSays: string): Promise<void> {
  await refuseOtherOrigins(page.context());
  await claimServiceWorkerControl(page);
  await serveFakeWeeb3(page, module);
  await serveConfig(page, { ...gateway.config(), weeb3: { enabled: true } });
  await gateway.attach(page);
  await page.goto('/');
  await pickNodeInThisBrowser(page, rowSays);
  await page.goto(gateway.watchPath());
}

test('weeb-3 picked for the video plays the stream in its own player, bare, once its node is ready', async ({
  page,
}) => {
  const gateway = new LadderGateway({ servesMaster: true });
  await openWatchPage(page, gateway, FAKE_WEEB3, 'Ready, 3 peers');

  const video = page.locator('.own-player video');
  const ownerAndTopic = gateway.watchPath().split('/').slice(-2).join('/');
  await expect(video).toHaveAttribute('data-weeb3', `${ownerAndTopic}/live`, { timeout: 20_000 });
  await expect(page.locator('.own-player-status'), 'nothing to say once the node is ready').toHaveCount(0);
  await expect(page.locator('.swarm-hls-feed-state'), 'none of the app overlays').toHaveCount(0);
  expect(gateway.unknownPaths(), 'every request was one the fake gateway knows').toEqual([]);
});

test('a weeb-3 node that fails says so on the watch page, and the video stays on weeb-3', async ({ page }) => {
  const gateway = new LadderGateway({ servesMaster: true });
  await openWatchPage(page, gateway, FAILING_WEEB3, 'Failed to start');

  await expect(page.locator('.own-player-status')).toHaveText(
    'The Swarm node in this browser could not play this stream.',
    { timeout: 20_000 },
  );
  await expect(page.locator('.swarm-hls-player-wrapper'), "the app's player never takes its place").toHaveCount(0);
});
