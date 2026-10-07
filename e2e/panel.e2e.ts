import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { THEME_NAMES } from '../src/design/themeNames';
import { refuseOtherOrigins, serveConfig } from './journey';
import { LadderGateway } from './ladderGateway';
import { GATEWAY_PATH, PREVIEW_ORIGIN } from './recording';

/**
 * The Sources screen against the fake gateway: opening the event gateway's details runs the Test on every part of a
 * live ladder, the picture is refused so one part fails, its sentence waits behind How to fix, and the diagnostics
 * hold the sentences and no other address. Set `PANEL_SCREENSHOTS_DIR` to a folder outside the repository to keep a
 * picture of the screen at 1440 and 390 wide.
 */

const SCREENSHOTS_DIR = process.env.PANEL_SCREENSHOTS_DIR;
const WIDTHS = [1440, 390] as const;

/** Each part's badge against this gateway, in the order the screen lists them. */
const EXPECTED_BADGES = [
  'Connection: passed',
  'Stream list: passed',
  'Video: passed',
  'Previews: passed',
  'Pictures: failed',
  'Chat: not applicable',
];

const PICTURE_FAILURE =
  'The gateway answered with an error (HTTP 500). Test again in a minute, or pick another gateway.';

async function screenshot(page: Page, name: string): Promise<void> {
  if (!SCREENSHOTS_DIR) {
    return;
  }
  const body = page.getByRole('dialog').locator('.dialog-body');
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width > 800 ? 1000 : 844 });
    // The screen's body scrolls between its title and its footer, so its top and its end are two pictures.
    for (const [part, top] of [
      ['top', 0],
      ['end', Number.MAX_SAFE_INTEGER],
    ] as const) {
      await body.evaluate((element, scrollTop) => element.scrollTo({ top: scrollTop }), top);
      await page.screenshot({ path: join(SCREENSHOTS_DIR, `${name}-${width}-${part}.png`) });
    }
  }
}

/** Opens the Sources screen and the event gateway's details, which runs its Test. */
async function openEventGateway(page: Page) {
  await page.getByRole('button', { name: /^Sources/ }).click();
  const screen = page.getByRole('dialog', { name: 'Sources' });
  const row = screen.locator('[data-source-row]', { hasText: 'Event gateway' });
  await row.getByRole('button', { name: 'Details of Event gateway', exact: true }).click();
  return { screen, row };
}

for (const theme of THEME_NAMES) {
  test(`${theme}: the Sources screen tests the gateway on every part, one failing, and copies diagnostics`, async ({
    page,
    context,
  }) => {
    const gateway = new LadderGateway({ servesMaster: true, pictureStatus: 500 });
    await refuseOtherOrigins(context);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: PREVIEW_ORIGIN });
    await serveConfig(page, { ...gateway.config(), theme });
    await gateway.attach(page);
    await page.goto('/');

    const { screen, row } = await openEventGateway(page);
    await expect(row.getByRole('radio', { name: 'Event gateway' }), 'the one gateway offered is in use').toBeChecked();
    await expect(row.locator('[data-health="ok"]'), 'the light check found the gateway answering').toBeVisible({
      timeout: 15_000,
    });

    const badges = row.getByRole('list', { name: 'Checks of Event gateway' }).getByRole('listitem');
    await expect(badges).toHaveText(EXPECTED_BADGES, { timeout: 30_000 });
    await expect(row.locator('.source-status-line')).toHaveText('Pictures failed');

    const fix = row.locator('details.source-fix');
    await expect(fix.getByText(PICTURE_FAILURE), 'the sentence waits behind How to fix').toBeHidden();
    await fix.locator('summary').click();
    await expect(fix.getByText(PICTURE_FAILURE)).toBeVisible();

    await screen.getByRole('button', { name: 'Copy diagnostics', exact: true }).click();
    await expect(screen.getByText('Diagnostics copied')).toBeVisible();
    const report = await page.evaluate(() => navigator.clipboard.readText());
    expect(report).toContain(`Test of Event gateway (${GATEWAY_PATH})`);
    expect(report).toContain(`Pictures: failed. ${PICTURE_FAILURE}`);
    expect(report).toContain('Status, the last minute');
    expect(report, 'the report names no address but the tested one').not.toMatch(/[a-z][a-z0-9+.-]*:\/\//i);

    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await screen
      .locator('.dialog-body')
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow, 'the screen does not scroll sideways at phone width').toBeLessThanOrEqual(0);

    await screenshot(page, `sources-${theme}`);
    expect(gateway.unknownPaths(), 'every request was one the fake gateway knows').toEqual([]);
  });
}

test('the Test passes a gateway the deployment offers that refuses /health and takes 6 s for the stream list head', async ({
  page,
  context,
}) => {
  const gateway = new LadderGateway({ servesMaster: true, catalogHeadExtraMs: 6_000, refusesHealth: true });
  await refuseOtherOrigins(context);
  await serveConfig(page, gateway.config());
  await gateway.attach(page);
  await page.goto('/');

  const { row } = await openEventGateway(page);

  const badges = row.getByRole('list', { name: 'Checks of Event gateway' }).getByRole('listitem');
  await expect(badges).toHaveCount(EXPECTED_BADGES.length, { timeout: 30_000 });
  await expect(badges.nth(0)).toHaveText('Connection: passed');
  await expect(badges.nth(1)).toHaveText('Stream list: passed');
  await expect(badges.nth(2)).toHaveText('Video: passed');
  expect(gateway.count('health'), 'an offered gateway is not asked for its health').toBe(0);
  expect(gateway.unknownPaths(), 'every request was one the fake gateway knows').toEqual([]);
});
