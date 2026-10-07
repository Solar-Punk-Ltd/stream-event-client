import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { THEME_NAMES } from '../src/design/themeNames';
import { refuseOtherOrigins, serveConfig } from './journey';
import { LadderGateway } from './ladderGateway';
import { GATEWAY_PATH, PREVIEW_ORIGIN } from './recording';

/**
 * The control panel against the fake gateway: Test reads every feature of a live ladder from it, the picture is
 * refused so one feature fails, and the report holds the sentences and no other address. Set
 * `PANEL_SCREENSHOTS_DIR` to a folder outside the repository to keep a picture of the panel at 1440 and 390 wide.
 */

const SCREENSHOTS_DIR = process.env.PANEL_SCREENSHOTS_DIR;
const WIDTHS = [1440, 390] as const;

/** What each check says against this gateway, in the order the panel lists them. */
const EXPECTED: readonly (readonly [string, RegExp | string])[] = [
  ['Connection: Passed', /^The gateway answered in \d+ ms\.$/],
  ['Stream list: Passed', 'The stream list loaded: 1 stream, entry 0.'],
  ['Video: Passed', 'The video loaded: the time marker of “Ladder test stream”, a playlist and one segment.'],
  ['Previews: Passed', 'Previews loaded: the preview playlist of “Ladder test stream”.'],
  [
    'Pictures: Failed',
    'The gateway answered with an error (HTTP 500). Test again in a minute, or pick another gateway.',
  ],
  ['Chat feed on this gateway: Not tested', 'Not tested: this site has no chat.'],
];

async function screenshot(page: Page, name: string): Promise<void> {
  if (!SCREENSHOTS_DIR) {
    return;
  }
  const dialog = page.getByRole('dialog');
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width > 800 ? 1000 : 844 });
    // The panel scrolls inside itself, so its top and its end are two pictures.
    for (const [part, top] of [
      ['top', 0],
      ['end', Number.MAX_SAFE_INTEGER],
    ] as const) {
      await dialog.evaluate((element, scrollTop) => element.scrollTo({ top: scrollTop }), top);
      await page.screenshot({ path: join(SCREENSHOTS_DIR, `${name}-${width}-${part}.png`) });
    }
  }
}

for (const theme of THEME_NAMES) {
  test(`${theme}: the control panel tests the gateway on every feature, one failing, and copies a report`, async ({
    page,
    context,
  }) => {
    const gateway = new LadderGateway({ servesMaster: true, pictureStatus: 500 });
    await refuseOtherOrigins(context);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: PREVIEW_ORIGIN });
    await serveConfig(page, { ...gateway.config(), theme });
    await gateway.attach(page);
    await page.goto('/');

    await page.getByRole('button', { name: /^Gateway/ }).click();
    const panel = page.getByRole('dialog', { name: 'Where the video loads from' });
    const row = panel.locator('[data-gateway-row]', { hasText: 'Event gateway' });
    await expect(row, 'the one gateway this config offers is in use').toContainText('In use');
    await row.getByRole('button', { name: 'Test', exact: true }).click();

    const results = panel.getByRole('list', { name: 'Test of Event gateway' });
    await expect(results.getByRole('listitem')).toHaveCount(EXPECTED.length, { timeout: 30_000 });
    for (const [at, [name, sentence]] of EXPECTED.entries()) {
      const item = results.getByRole('listitem').nth(at);
      await expect(item.locator('.panel-result-name')).toHaveText(name);
      await expect(item.locator('.panel-result-sentence')).toHaveText(sentence);
    }
    await expect(panel.getByRole('region', { name: 'Status' })).toContainText('Reads from Event gateway');

    await panel.getByRole('button', { name: 'Copy report', exact: true }).click();
    await expect(panel.getByText('Report copied.')).toBeVisible();
    const report = await page.evaluate(() => navigator.clipboard.readText());
    expect(report).toContain(`Test of Event gateway (${GATEWAY_PATH})`);
    expect(report).toContain(
      'Pictures: failed. The gateway answered with an error (HTTP 500). Test again in a minute, or pick another gateway.',
    );
    expect(report).toContain('Status, the last minute');
    expect(report, 'the report names no address but the tested one').not.toMatch(/[a-z][a-z0-9+.-]*:\/\//i);

    await screenshot(page, `panel-${theme}`);
    expect(gateway.unknownPaths(), 'every request was one the fake gateway knows').toEqual([]);
  });
}
