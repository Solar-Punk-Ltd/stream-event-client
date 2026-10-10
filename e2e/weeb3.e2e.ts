import { expect, test, type Page } from '@playwright/test';

import { refuseOtherOrigins, serveConfig } from './journey';
import { LadderGateway } from './ladderGateway';

/**
 * The node in this browser, weeb-3, against a fake of its package: the chunk the page loads it from is answered with a
 * module of the package's shape, whose node has peers and whose player attaches and never shows a picture. Picked on
 * the Sources screen for the video, it plays bare in its own player, and once its first picture is overdue the app's
 * player takes over from the fake gateway behind it. The real package and the network are never reached.
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

async function serveFakeWeeb3(page: Page): Promise<void> {
  await page.route(/\/assets\/(weeb3StandIn|weeb_3)-[^/]+\.js$/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_WEEB3 }),
  );
}

async function pickNodeInThisBrowser(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Sources/ }).click();
  const screen = page.getByRole('dialog', { name: 'Sources' });
  await screen.getByRole('button', { name: 'Add source', exact: true }).click();
  await screen.getByRole('button', { name: /^Node in this browser/ }).click();
  await screen.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(screen.getByRole('radio', { name: 'Node in this browser' }), 'the new source is in use').toBeChecked();
  await screen.getByRole('button', { name: 'Done', exact: true }).click();
}

async function openWatchPage(page: Page, gateway: LadderGateway): Promise<void> {
  await refuseOtherOrigins(page.context());
  await serveFakeWeeb3(page);
  await serveConfig(page, { ...gateway.config(), weeb3: { enabled: true } });
  await gateway.attach(page);
  await page.goto('/');
  await pickNodeInThisBrowser(page);
  await page.goto(gateway.watchPath());
}

test('weeb-3 picked for the video plays the stream in its own player, bare, with a plain line while it starts', async ({
  page,
}) => {
  const gateway = new LadderGateway({ servesMaster: true });
  await openWatchPage(page, gateway);

  const video = page.locator('.own-player video');
  const ownerAndTopic = gateway.watchPath().split('/').slice(-2).join('/');
  await expect(video).toHaveAttribute('data-weeb3', `${ownerAndTopic}/live`, { timeout: 20_000 });
  await expect(page.getByRole('status')).toHaveText('Starting the Swarm node in this browser');
  await expect(page.locator('.swarm-hls-feed-state'), 'none of the app overlays').toHaveCount(0);
  expect(gateway.unknownPaths(), 'every request was one the fake gateway knows').toEqual([]);
});

test("the app's player takes over from the gateway behind it when weeb-3 shows no picture in time", async ({
  page,
}) => {
  const gateway = new LadderGateway({ servesMaster: true });
  await openWatchPage(page, gateway);
  await expect(page.locator('.own-player video')).toBeVisible({ timeout: 20_000 });

  const ours = page.locator('.swarm-hls-player-wrapper video');
  await expect(ours, "the app's player is in place once the deadline passes").toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.own-player')).toHaveCount(0);
  await expect
    .poll(() => ours.evaluate((element: HTMLVideoElement) => element.currentTime), {
      message: 'the stream plays from the gateway',
      timeout: 45_000,
    })
    .toBeGreaterThan(1);
  expect(gateway.unknownPaths(), 'every request was one the fake gateway knows').toEqual([]);
});
