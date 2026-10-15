import { expect, test, type Page } from '@playwright/test';

import { claimServiceWorkerControl, FAILING_WEEB3, FAKE_WEEB3, serveFakeWeeb3 } from './fakeWeeb3';
import { refuseOtherOrigins, serveConfig } from './journey';
import { LadderGateway } from './ladderGateway';

/**
 * The node in this browser, weeb-3, against a fake of its package: the chunk the page loads it from is answered with a
 * module of the package's shape, and its WebAssembly module with a few bytes. The page is told a service worker
 * controls it, which the real package's worker would, so the node can be ready. A viewer who added it before picks it
 * for the video in Connect, where its row shows how far the node has got, and on the watch page it plays bare in its
 * own player once the node is ready. A node that fails says so and nothing takes its place. Picked for all features,
 * it reads the stream list through its own route and the gateway is never asked for it. Adding it, which reads real
 * chunks through it, is the unit suite's, since a fake package serves none. The real package and the network are never
 * reached.
 */

test.describe.configure({ timeout: 120_000 });

/** The node in this browser as an earlier visit added it, which this browser keeps. */
async function keepAddedNode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('swarm-sources', JSON.stringify([{ id: 'added-1', type: 'weeb-3', name: 'Weeb3', url: '' }]));
  });
}

async function pickNodeInThisBrowser(page: Page, rowSays: string): Promise<void> {
  await page.getByRole('banner').getByRole('button', { name: 'Connect', exact: true }).click();
  const connect = page.getByRole('dialog');
  const useFor = connect.getByRole('region', { name: 'Use for' });
  await expect(
    useFor.getByLabel('All features', { exact: true }).locator('option', { hasText: 'Weeb3' }),
    'it can be the one source for all features, as any source',
  ).toBeEnabled();
  await useFor.getByRole('button', { name: 'Per feature', exact: true }).click();
  await useFor.getByLabel('Video', { exact: true }).selectOption({ label: 'Weeb3' });
  const row = connect.locator('[data-source-row]', { hasText: 'Weeb3' });
  await expect(row, 'the row says how far the node has got').toContainText(rowSays, { timeout: 20_000 });
  await connect.getByRole('button', { name: 'Close Connect', exact: true }).click();
}

async function openWatchPage(page: Page, gateway: LadderGateway, module: string, rowSays: string): Promise<void> {
  await refuseOtherOrigins(page.context());
  await claimServiceWorkerControl(page);
  await serveFakeWeeb3(page, module);
  await serveConfig(page, gateway.config());
  await gateway.attach(page);
  await keepAddedNode(page);
  await page.goto('/');
  await pickNodeInThisBrowser(page, rowSays);
  await page.goto(gateway.watchPath());
}

test('weeb-3 picked for the video plays the stream in its own player, bare, once its node is ready', async ({
  page,
}) => {
  const gateway = new LadderGateway({ servesMaster: true });
  await openWatchPage(page, gateway, FAKE_WEEB3, '3 of 200 peers');

  const video = page.locator('.own-player video');
  const ownerAndTopic = gateway.watchPath().split('/').slice(-2).join('/');
  await expect(video).toHaveAttribute('data-weeb3', `${ownerAndTopic}/live`, { timeout: 20_000 });
  await expect(page.locator('.own-player-status'), 'nothing under the player once the node is ready').toHaveCount(0);
  await page.locator('.own-player').evaluate((stage) => {
    const menu = document.createElement('select');
    menu.setAttribute('data-weeb3-hls-quality', '');
    stage.append(menu);
  });
  await expect(page.locator('.own-player [data-weeb3-hls-quality]'), "weeb-3's quality menu is hidden").toBeHidden();
  await expect(page.locator('.swarm-hls-feed-state'), 'none of the app overlays').toHaveCount(0);
  expect(gateway.unknownPaths(), 'every request was one the fake gateway knows').toEqual([]);
});

test('a weeb-3 node that fails says so on the watch page, and the video stays on weeb-3', async ({ page }) => {
  const gateway = new LadderGateway({ servesMaster: true });
  await openWatchPage(page, gateway, FAILING_WEEB3, 'Failed to start');

  await expect(page.locator('.own-player-words')).toHaveText('Failed to start', { timeout: 20_000 });
  await expect(page.locator('.swarm-hls-player-wrapper'), "the app's player never takes its place").toHaveCount(0);
});

test('weeb-3 picked for all features reads the stream list through the node, and the gateway is never asked for it', async ({
  page,
}) => {
  const gateway = new LadderGateway({ servesMaster: true });
  await refuseOtherOrigins(page.context());
  await claimServiceWorkerControl(page);
  await serveFakeWeeb3(page, FAKE_WEEB3);
  await serveConfig(page, gateway.config());
  await gateway.attach(page);
  await gateway.attachAsWeeb3(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) {
      return;
    }
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('swarm-sources', JSON.stringify([{ id: 'added-1', type: 'weeb-3', name: 'Weeb3', url: '' }]));
    localStorage.setItem(
      'swarm-routing',
      JSON.stringify({
        mode: 'one',
        source: 'added-1',
        parts: { player: 'added-1', 'stream-list': 'added-1', previews: 'added-1', chat: 'added-1' },
      }),
    );
  });

  await page.goto('/');

  await expect(page.getByText('Ladder test stream').first()).toBeVisible({ timeout: 60_000 });
  expect(gateway.count('weeb3Catalog'), 'the list came through the node').toBeGreaterThan(0);
  expect(gateway.count('catalog'), 'the gateway was never asked for the list').toBe(0);
});
