import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { THEME_LABELS, THEME_NAMES, type ThemeName } from '../src/design/themeNames';
import { answerSlotNotesAsAbsent, refuseOtherOrigins, serveConfig } from './journey';
import { GATEWAY_URL_PATTERN, type Published, RECORDED_DIR, RecordingFile, SMOKE_USER } from './recording';

/**
 * The theme switcher under the viewer's ID in Connect, against the recorded deployment: a pick dresses the page in that
 * theme's colours and typefaces, leaves the deployment's words and tab alone, and survives a reload and a guest leaving.
 * Set `THEME_SCREENSHOTS_DIR` to a folder outside the repository to keep a picture of the browse page in every
 * theme at 1440 and 390 wide.
 */

const SCREENSHOTS_DIR = process.env.THEME_SCREENSHOTS_DIR;
const WIDTHS = [1440, 390] as const;

/** Each theme's page colour, as the browser computes the body's background. */
const PAGE_COLOUR: Record<ThemeName, string> = {
  swarm: 'rgb(21, 21, 23)',
  web3privacy: 'rgb(0, 0, 0)',
};

const read = <T>(file: string): T => JSON.parse(readFileSync(join(RECORDED_DIR, file), 'utf8')) as T;

async function wornTheme(page: Page) {
  return page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    background: getComputedStyle(document.body).backgroundColor,
    title: document.title,
  }));
}

async function openNameMenu(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: SMOKE_USER, exact: true }).click();
  return page.getByRole('dialog').getByRole('radiogroup', { name: 'Theme' });
}

async function joinAsGuest(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Your name', exact: true }).fill(SMOKE_USER);
  await page.getByRole('dialog').getByRole('button', { name: 'Chat as guest', exact: true }).click();
  await page.keyboard.press('Escape');
}

async function screenshots(page: Page, theme: ThemeName): Promise<void> {
  if (!SCREENSHOTS_DIR) {
    return;
  }
  // The page's colours ease from one theme to the next, so the pictures wait for that to finish.
  await page.waitForTimeout(500);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width > 800 ? 1000 : 844 });
    await page.screenshot({ path: join(SCREENSHOTS_DIR, `browse-${theme}-${width}.png`), fullPage: true });
    await openNameMenu(page);
    await page.screenshot({
      path: join(SCREENSHOTS_DIR, `menu-${theme}-${width}.png`),
      clip: { x: 0, y: 0, width, height: 360 },
    });
    await page.keyboard.press('Escape');
  }
}

test("a logged-in viewer switches the look, keeps the deployment's words, and keeps the pick", async ({
  page,
  context,
}) => {
  await refuseOtherOrigins(context);
  await page.routeFromHAR(join(RECORDED_DIR, RecordingFile.HAR), { url: GATEWAY_URL_PATTERN, notFound: 'abort' });
  await serveConfig(page, { ...read<object>(RecordingFile.CONFIG), theme: 'swarm' });
  await page.goto('/');

  const before = await wornTheme(page);
  expect(before.theme).toBe('swarm');
  expect(await page.getByRole('radiogroup', { name: 'Theme' }).count(), 'no switcher before logging in').toBe(0);

  await joinAsGuest(page);

  const heroTitle = await page.getByRole('heading', { level: 1 }).textContent();
  for (const theme of THEME_NAMES) {
    const group = await openNameMenu(page);
    await group.getByRole('radio', { name: THEME_LABELS[theme], exact: true }).click();
    await expect(group.getByRole('radio', { name: THEME_LABELS[theme], exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.keyboard.press('Escape');

    const worn = await wornTheme(page);
    expect(worn.theme).toBe(theme);
    expect(worn.background, `the page wears ${theme}'s colour`).toBe(PAGE_COLOUR[theme]);
    expect(worn.title, "the tab keeps the deployment's title").toBe(before.title);
    await expect(page.getByRole('heading', { level: 1 }), "the hero keeps the deployment's words").toHaveText(
      heroTitle ?? '',
    );
    await screenshots(page, theme);
    await page.setViewportSize({ width: 1280, height: 720 });
  }

  // The arrows move the pick from the checked option, wrapping past the last theme.
  const group = await openNameMenu(page);
  await group.getByRole('radio', { checked: true }).focus();
  await page.keyboard.press('ArrowDown');
  expect((await wornTheme(page)).theme, 'ArrowDown wraps to the first theme').toBe(THEME_NAMES[0]);
  await expect(group.getByRole('radio', { name: THEME_LABELS[THEME_NAMES[0]], exact: true })).toBeFocused();
  await page.keyboard.press('End');
  expect((await wornTheme(page)).theme).toBe('web3privacy');
  await page.reload();
  expect((await wornTheme(page)).theme, 'the pick survives a reload').toBe('web3privacy');

  await page.getByRole('banner').getByRole('button', { name: SMOKE_USER, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Leave', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Leave', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('banner').getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  expect((await wornTheme(page)).theme, 'the pick survives a guest leaving').toBe('web3privacy');
});

test('pictures of the watch page, its chat and the dialogs in every look', async ({ page, context }) => {
  test.skip(!SCREENSHOTS_DIR, 'set THEME_SCREENSHOTS_DIR to keep the pictures');
  const dir = SCREENSHOTS_DIR as string;
  const published = read<Published>(RecordingFile.PUBLISHED);
  const config = read<{ chat: { feedOwner: string } }>(RecordingFile.CONFIG);

  await refuseOtherOrigins(context);
  await page.routeFromHAR(join(RECORDED_DIR, RecordingFile.HAR), { url: GATEWAY_URL_PATTERN, notFound: 'abort' });
  await serveConfig(page, { ...config, theme: 'swarm' });
  await answerSlotNotesAsAbsent(page, published.chat.topic, config.chat.feedOwner);
  await page.goto('/');
  await joinAsGuest(page);
  await page.getByRole('link', { name: new RegExp(published.stream.title) }).click();
  const chat = page.getByRole('region', { name: 'Chat', exact: true });
  await expect(chat.getByText(published.chat.texts[0], { exact: true })).toBeVisible({ timeout: 20_000 });

  for (const theme of THEME_NAMES) {
    const group = await openNameMenu(page);
    await group.getByRole('radio', { name: THEME_LABELS[theme], exact: true }).click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width > 800 ? 1000 : 844 });
      await page.screenshot({ path: join(dir, `watch-${theme}-${width}.png`), fullPage: true });

      await page.getByRole('banner').getByRole('button', { name: SMOKE_USER, exact: true }).click();
      await page.screenshot({ path: join(dir, `connect-${theme}-${width}.png`) });
      await page.getByRole('dialog').getByRole('button', { name: 'Leave', exact: true }).click();
      await page.screenshot({ path: join(dir, `leave-${theme}-${width}.png`) });
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({ width: 1280, height: 720 });
  }
});
