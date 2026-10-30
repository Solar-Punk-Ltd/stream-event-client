import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { PREVIEW_ORIGIN } from './recording';
import { serveWithoutHeaders, type StaticSite } from './staticSite';

/**
 * The real weeb-3 package taking control of the page through its service worker, which every read of the node goes
 * through. Starting the node is enough: it registers the worker before it looks for peers, and no peer is ever
 * reached, since every other origin is refused. One host sends no headers of its own, the way an ENS gateway or a Bee
 * node serves the site, and one is `vite preview`, which sends `Service-Worker-Allowed` the way the image does.
 */

const CONFIG = { gatewayUrl: '/bee', catalog: { owner: `0x${'1'.repeat(40)}`, topic: 'weeb3-worker-test' } };
const HOST_WORKER = '/weeb-3-host.js';
const PACKAGE_WORKER = '/weeb-3/service.js';
const SCOPE_REFUSED = /max scope allowed/i;

test.describe.configure({ timeout: 120_000 });

async function onlyThisOrigin(page: Page, origin: string): Promise<void> {
  await page.context().route(
    (url) => url.origin !== origin,
    (route) => route.abort('blockedbyclient'),
  );
  await page.route(`${origin}/config.json`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CONFIG) }),
  );
}

/** Opens My Swarm and starts adding the node in this browser, which starts it. */
async function startTheNode(page: Page): Promise<void> {
  await page.getByRole('banner').getByRole('button', { name: 'My Swarm', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add source' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Weeb3/ }).first().click();
}

function controllingWorker(page: Page): Promise<string | null> {
  return page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null);
}

function registeredWorkers(page: Page): Promise<string[]> {
  return page.evaluate(async () =>
    (await navigator.serviceWorker.getRegistrations()).map(
      (registration) => `${registration.scope} ${registration.active?.scriptURL ?? 'none'}`,
    ),
  );
}

test.describe('on a host that sends no Service-Worker-Allowed header', () => {
  let site: StaticSite;

  test.beforeAll(async () => {
    site = await serveWithoutHeaders(join(import.meta.dirname, '..', 'dist'));
  });

  test.afterAll(async () => {
    await site.close();
  });

  test("weeb-3's worker controls the page once the node starts, on the first visit, without a reload", async ({
    page,
  }) => {
    const messages: string[] = [];
    page.on('console', (message) => messages.push(message.text()));
    await onlyThisOrigin(page, site.origin);
    await page.goto(`${site.origin}/`);
    expect(await controllingWorker(page), 'a fresh browser has no worker yet').toBeNull();

    await startTheNode(page);

    await expect
      .poll(() => controllingWorker(page), { message: 'the worker took control of the page', timeout: 30_000 })
      .toBe(`${site.origin}${HOST_WORKER}`);
    expect(await registeredWorkers(page)).toEqual([`${site.origin}/ ${site.origin}${HOST_WORKER}`]);
    expect(
      messages.filter((text) => SCOPE_REFUSED.test(text)),
      'the browser refused no scope',
    ).toEqual([]);
  });
});

test.describe('on a host that sends the header, as the image does', () => {
  test("a browser that kept weeb-3's own worker from an earlier version moves to the root one, once", async ({
    page,
  }) => {
    await onlyThisOrigin(page, PREVIEW_ORIGIN);
    await page.goto('/');
    await page.evaluate(async (worker) => {
      await navigator.serviceWorker.register(worker, { scope: '/' });
      await navigator.serviceWorker.ready;
    }, PACKAGE_WORKER);
    await page.reload();
    expect(await controllingWorker(page), 'the earlier version left its worker in control').toBe(
      `${PREVIEW_ORIGIN}${PACKAGE_WORKER}`,
    );

    await startTheNode(page);

    await expect
      .poll(() => controllingWorker(page), { message: 'the root worker took over', timeout: 30_000 })
      .toBe(`${PREVIEW_ORIGIN}${HOST_WORKER}`);
    expect(await registeredWorkers(page)).toEqual([`${PREVIEW_ORIGIN}/ ${PREVIEW_ORIGIN}${HOST_WORKER}`]);

    await page.reload();
    await startTheNode(page);
    await page.waitForTimeout(5_000);
    expect(await controllingWorker(page), 'the next visit keeps it, and weeb-3 never puts its own back').toBe(
      `${PREVIEW_ORIGIN}${HOST_WORKER}`,
    );
    expect(await registeredWorkers(page)).toEqual([`${PREVIEW_ORIGIN}/ ${PREVIEW_ORIGIN}${HOST_WORKER}`]);
  });
});
