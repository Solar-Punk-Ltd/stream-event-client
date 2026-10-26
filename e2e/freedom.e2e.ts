import { expect, test } from '@playwright/test';

import { openInFakeFreedom } from './fakeFreedom';
import { refuseOtherOrigins, serveConfig } from './journey';
import { LadderGateway } from './ladderGateway';

/**
 * The Freedom browser's own node, against a fake of Freedom's `window.swarm` over the fake gateway's content. A viewer
 * in Freedom adds it in My Swarm, where its checks read through `window.swarm`, connects the site on their own click,
 * and picks it for the stream list, which the browse page then reads through Freedom and not from the gateway. Outside
 * Freedom it is not offered. Its segments and pictures load at `bzz://` URLs, which Chromium refuses here before any
 * route could answer them, so the unit suite covers that path (`test/CustomFragmentLoader.test.ts`). Nothing here runs
 * in Freedom itself.
 */

test.describe.configure({ timeout: 90_000 });

test("a viewer in Freedom adds this browser's Swarm node, connects the site, and reads the stream list through it", async ({
  page,
  context,
}) => {
  const gateway = new LadderGateway({ servesMaster: true });
  await refuseOtherOrigins(context);
  await serveConfig(page, gateway.config());
  await gateway.attach(page);
  const freedom = await openInFakeFreedom(page, gateway);
  await page.goto('/');

  await page.getByRole('banner').getByRole('button', { name: 'My Swarm', exact: true }).click();
  const connect = page.getByRole('dialog');
  await connect.getByRole('button', { name: 'Add source', exact: true }).click();
  await connect.getByRole('button', { name: /^This browser's Swarm node/ }).click();
  await expect(connect.getByRole('heading', { name: "Add this browser's Swarm node" })).toBeVisible();
  const add = connect.getByRole('button', { name: 'Add node', exact: true });
  await expect(add, 'its checks passed through window.swarm').toBeEnabled({ timeout: 20_000 });
  expect(
    await connect.locator('[data-check]').evaluateAll((lines) => lines.map((line) => line.getAttribute('data-state'))),
  ).toEqual(['passed', 'passed', 'passed']);
  expect(freedom.methods, 'the page asked for no connection on its own').not.toContain('swarm_requestAccess');

  await connect.getByRole('button', { name: 'Connect this site', exact: true }).click();
  await expect(connect.getByText('This site is connected to Freedom')).toBeVisible();
  expect(freedom.methods.filter((method) => method === 'swarm_requestAccess')).toHaveLength(1);
  await add.click();

  const useFor = connect.getByRole('region', { name: 'Use for' });
  await useFor.getByRole('button', { name: 'Per feature', exact: true }).click();
  await useFor.getByLabel('Stream list', { exact: true }).selectOption({ label: "This browser's Swarm node" });
  await expect(
    useFor.getByLabel('Chat history', { exact: true }).locator('option', { hasText: "This browser's Swarm node" }),
  ).toHaveCount(0);
  await connect.getByRole('button', { name: 'Close My Swarm', exact: true }).click();

  const catalogFromGateway = gateway.count('catalog');
  const catalogFromFreedom = gateway.count('freedomCatalog');
  await page.reload();
  await expect(page.getByText('Ladder test stream').first()).toBeVisible({ timeout: 30_000 });
  expect(gateway.count('freedomCatalog'), 'the list came through Freedom').toBeGreaterThan(catalogFromFreedom);
  expect(gateway.count('catalog'), 'the gateway was not asked for the list').toBe(catalogFromGateway);
  expect(gateway.unknownPaths(), 'every request was one the fake gateway knows').toEqual([]);
});

test("outside Freedom, this browser's Swarm node is not offered", async ({ page, context }) => {
  const gateway = new LadderGateway({ servesMaster: true });
  await refuseOtherOrigins(context);
  await serveConfig(page, gateway.config());
  await gateway.attach(page);
  await page.goto('/');

  await page.getByRole('banner').getByRole('button', { name: 'My Swarm', exact: true }).click();
  const connect = page.getByRole('dialog');
  await connect.getByRole('button', { name: 'Add source', exact: true }).click();
  await expect(connect.locator('.connect-tile')).toHaveCount(3);
  await expect(connect.getByRole('button', { name: /^This browser's Swarm node/ })).toHaveCount(0);
});
