import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { THEME_NAMES } from '../src/design/themeNames';
import { refuseOtherOrigins, serveConfig } from './journey';
import { LadderGateway } from './ladderGateway';
import { GATEWAY_PATH, PREVIEW_ORIGIN } from './recording';

/**
 * Connect against the fake gateway: the event gateway's settings run its checks, every one passing, and copy
 * diagnostics with no other address. A second fake gateway at an https address of its own is added through its
 * checks, chosen for all features, and taken down: the page says which part cannot load from it and nothing moves
 * to the event gateway. Set `CONNECT_SCREENSHOTS_DIR` to a folder outside the repository to keep pictures of
 * Connect at 1440 and 390 wide.
 */

const SCREENSHOTS_DIR = process.env.CONNECT_SCREENSHOTS_DIR;
const WIDTHS = [1440, 390] as const;

/** The second gateway a viewer adds. Made up, and answered by the page's own route before any request leaves it. */
const ADDED_GATEWAY = 'https://gw.example.org';

const CHECK_LINES = [
  'Answers over https',
  'Allows this site (CORS)',
  'Bee 2.6 or later',
  'Reads a chunk',
  'Reads bytes',
  "Reads this event's stream list",
];

async function screenshot(page: Page, name: string): Promise<void> {
  if (!SCREENSHOTS_DIR) {
    return;
  }
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width > 800 ? 1000 : 844 });
    await page.screenshot({ path: join(SCREENSHOTS_DIR, `${name}-${width}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

const connect = (page: Page) => page.getByRole('dialog');

async function openConnect(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(connect(page).getByRole('heading', { name: 'Connect', exact: true })).toBeVisible();
}

/** Every check's line with its state, as a screen reader hears it. */
async function checkStates(page: Page): Promise<string[]> {
  return page
    .locator('[data-check]')
    .evaluateAll((lines) => lines.map((line) => line.getAttribute('data-state') ?? ''));
}

for (const theme of THEME_NAMES) {
  test(`${theme}: Connect checks the event gateway from its settings, every check passing, and copies diagnostics`, async ({
    page,
    context,
  }) => {
    const gateway = new LadderGateway({ servesMaster: true });
    await refuseOtherOrigins(context);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: PREVIEW_ORIGIN });
    await serveConfig(page, { ...gateway.config(), theme });
    await gateway.attach(page);
    await page.goto('/');

    await openConnect(page);
    const row = connect(page).locator('[data-source-row]', { hasText: 'Event gateway' });
    await expect(row).toContainText('Offered');
    await expect(row.locator('[data-health="ok"]'), 'the light check found the gateway answering').toBeVisible({
      timeout: 15_000,
    });
    await screenshot(page, `connect-${theme}`);

    await row.getByRole('button', { name: 'Settings of Event gateway', exact: true }).click();
    await expect(connect(page).getByText('Offered by this event. It cannot be changed or removed.')).toBeVisible();
    await connect(page).getByRole('button', { name: 'Test connection', exact: true }).click();
    await expect(page.locator('[data-check]')).toContainText(CHECK_LINES);
    await expect.poll(() => checkStates(page), { timeout: 40_000 }).toEqual(CHECK_LINES.map(() => 'passed'));
    await screenshot(page, `settings-${theme}`);

    await connect(page).getByRole('button', { name: 'Copy diagnostics', exact: true }).click();
    await expect(connect(page).getByText('Diagnostics copied')).toBeVisible();
    const report = await page.evaluate(() => navigator.clipboard.readText());
    expect(report).toContain(`Checks of Event gateway (${GATEWAY_PATH})`);
    expect(report).toContain('Reads a chunk: passed');
    expect(report).toContain('Status, the last minute');
    expect(report, 'the report names no address but the checked one').not.toMatch(/[a-z][a-z0-9+.-]*:\/\//i);

    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await connect(page)
      .locator('.dialog-body')
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow, 'Connect does not scroll sideways at phone width').toBeLessThanOrEqual(0);
    expect(gateway.unknownPaths(), 'every request was one the fake gateway knows').toEqual([]);
  });
}

test("the event gateway's version line passes as not stated when it keeps its health to itself", async ({
  page,
  context,
}) => {
  const gateway = new LadderGateway({ servesMaster: true, catalogHeadExtraMs: 6_000, refusesHealth: true });
  await refuseOtherOrigins(context);
  await serveConfig(page, gateway.config());
  await gateway.attach(page);
  await page.goto('/');

  await openConnect(page);
  await connect(page).getByRole('button', { name: 'Settings of Event gateway', exact: true }).click();
  await connect(page).getByRole('button', { name: 'Test connection', exact: true }).click();

  await expect.poll(() => checkStates(page), { timeout: 40_000 }).toEqual(CHECK_LINES.map(() => 'passed'));
  await expect(page.locator('[data-check="version"]')).toContainText('not stated');
  expect(gateway.unknownPaths(), 'every request was one the fake gateway knows').toEqual([]);
});

test('a gateway the viewer adds passes its checks, is chosen for all features, and fails without anything moving', async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  const event = new LadderGateway({ servesMaster: true });
  const added = new LadderGateway({ servesMaster: true });
  await refuseOtherOrigins(context);
  await serveConfig(page, event.config());
  await event.attach(page);
  await added.attachAt(page, ADDED_GATEWAY);
  await page.goto('/');

  await openConnect(page);
  await connect(page).getByRole('button', { name: 'Add source', exact: true }).click();
  await connect(page)
    .getByRole('button', { name: /^Gateway/ })
    .click();
  const addButton = connect(page).getByRole('button', { name: 'Add gateway', exact: true });
  await expect(addButton, 'nothing is added before the checks pass').toBeDisabled();
  await connect(page).getByLabel('Address', { exact: true }).fill(ADDED_GATEWAY);
  await connect(page).getByLabel('Name', { exact: true }).fill('Second gateway');
  await connect(page).getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect.poll(() => checkStates(page), { timeout: 40_000 }).toEqual(CHECK_LINES.map(() => 'passed'));
  await addButton.click();

  await expect(connect(page).locator('[data-source-row]', { hasText: 'Second gateway' })).toContainText(
    `Gateway · ${ADDED_GATEWAY}`,
  );
  await connect(page)
    .getByRole('region', { name: 'Use for' })
    .getByLabel('All features', { exact: true })
    .selectOption({ label: 'Second gateway' });
  await connect(page).getByRole('button', { name: 'Close Connect', exact: true }).click();

  await page.goto(event.watchPath());
  await expect(page.getByText('via Second gateway')).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() => added.requests.filter(({ kind }) => kind === 'segment').length, { timeout: 30_000 })
    .toBeGreaterThan(0);

  const downAtMs = Date.now();
  added.goDown();
  const bar = page.locator('[data-failing-part="player"]');
  await expect(bar).toContainText('Video cannot load from Second gateway.', { timeout: 40_000 });
  await expect(bar).toContainText(/No answer for \d+ s\./);
  expect(event.requestsSince(downAtMs), 'nothing moved to the event gateway').toBe(0);
  console.log(`the failure bar showed ${Math.round((Date.now() - downAtMs) / 1000)} s after the gateway went down`);

  await bar.getByRole('button', { name: 'Choose another source', exact: true }).click();
  await expect(connect(page).getByRole('heading', { name: 'Connect', exact: true })).toBeVisible();
});
