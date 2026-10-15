import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, type Locator, type Page, test } from '@playwright/test';
import { MessageVia, parseChatMessage } from '@solarpunkltd/swarm-chat-js';

import { claimServiceWorkerControl, FAKE_WEEB3, serveFakeWeeb3, weeb3Pushes } from './fakeWeeb3';
import { answerSlotNotesAsAbsent, refuseOtherOrigins, serveConfig } from './journey';
import {
  ACCOUNT_NAME,
  CHAT_ADDRESS,
  FAKE_SWARM_ID_ORIGIN,
  type FakeSiteStamp,
  serveFakeSwarmIdSite,
} from './fakeSwarmIdSite';
import {
  GATEWAY_PATH,
  GATEWAY_URL_PATTERN,
  PREVIEW_ORIGIN,
  type Published,
  RECORDED_DIR,
  RecordingFile,
} from './recording';

/**
 * Signing in with Swarm ID through its own button, and sending chat messages on the viewer's own stamp, against the
 * recorded deployment and a fake Swarm ID site whose session frame keeps a signed-in session, or signs one in once its
 * button is clicked. The viewer's own Bee node is a made-up address on this computer, answered by the page's
 * routes: its reads replay the recording, and its writes are recorded and taken. A message on the stamp is stamped by
 * the fake Swarm ID and posted to that node, never to the event gateway, and with the own feed on its copy goes first.
 * A stamp that ran out holds the message field with a way to let the gateway pay. With Weeb3, a fake of the node in
 * this browser, picked for the chat history instead, the chat reads through it and a message on the stamp is pushed
 * through it, to no Bee node and not to the gateway.
 */

const MY_BEE_NODE = 'http://localhost:1633';
const DAY_S = 24 * 60 * 60;
const SITE_STAMP: FakeSiteStamp = {
  label: 'Event chat',
  utilization: 0.25,
  usable: true,
  exists: true,
  batchTTL: 30 * DAY_S,
};
const SPAN_BYTES = 8;
const PHONE = { width: 360, height: 740 };
const NARROWEST_PHONE = { width: 320, height: 640 };

const read = <T>(file: string): T => JSON.parse(readFileSync(join(RECORDED_DIR, file), 'utf8')) as T;

interface Written {
  url: string;
  stamp: string | null;
  body: Buffer;
}

/** The source the chat history reads from: the viewer's own Bee node, or Weeb3, the node in this browser. */
type ChatSource = 'bee-node' | 'weeb-3';

/**
 * The deployment as recorded, with Swarm ID offered, and the viewer's own Bee node or Weeb3 added and picked for the
 * chat history while everything else reads the event gateway, as a browser that chose so before keeps it. Weeb3's
 * chat reads find nothing, so its chat opens empty.
 */
async function deployment(
  page: Page,
  siteStamp: () => FakeSiteStamp | undefined,
  chatSource: ChatSource = 'bee-node',
  pickStamp: () => void = () => {},
  startsSignedIn = true,
) {
  const published = read<Published>(RecordingFile.PUBLISHED);
  const config = read<{ chat: { feedOwner: string; writeUrl: string } }>(RecordingFile.CONFIG);
  const toGateway: Written[] = [];
  const toMyNode: Written[] = [];

  await refuseOtherOrigins(page.context());
  await page.routeFromHAR(join(RECORDED_DIR, RecordingFile.HAR), { url: GATEWAY_URL_PATTERN, notFound: 'abort' });
  await serveConfig(page, { ...config, swarmId: { url: FAKE_SWARM_ID_ORIGIN } });
  await answerSlotNotesAsAbsent(page, published.chat.topic, config.chat.feedOwner);
  await page.route(`${PREVIEW_ORIGIN}${GATEWAY_PATH}/soc/**`, async (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }
    toGateway.push({
      url: route.request().url(),
      stamp: null,
      body: route.request().postDataBuffer() ?? Buffer.alloc(0),
    });
    await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
  });
  await page.route(`${MY_BEE_NODE}/**`, async (route) => {
    const request = route.request();
    const { pathname, search } = new URL(request.url());
    if (request.method() === 'POST') {
      toMyNode.push({
        url: request.url(),
        stamp: request.headers()['swarm-postage-stamp'] ?? null,
        body: request.postDataBuffer() ?? Buffer.alloc(0),
      });
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{"reference":"00"}' });
    }
    if (pathname.startsWith(`/feeds/${CHAT_ADDRESS}/`)) {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: '{"message":"Not Found","code":404}',
      });
    }
    return route.fallback({ url: `${PREVIEW_ORIGIN}${GATEWAY_PATH}${pathname}${search}` });
  });
  if (chatSource === 'weeb-3') {
    await claimServiceWorkerControl(page);
    await serveFakeWeeb3(page, FAKE_WEEB3);
    await page.route(`${PREVIEW_ORIGIN}/weeb-3/chunks/**`, (route) =>
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'weeb-3 did not retrieve resource' }),
    );
  }
  const swarmId = await serveFakeSwarmIdSite(page, siteStamp, pickStamp, startsSignedIn);

  await page.addInitScript(
    ({ node, type }) => {
      if (sessionStorage.getItem('seeded')) {
        return;
      }
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(
        'swarm-sources',
        JSON.stringify([
          type === 'weeb-3'
            ? { id: 'added-1', type, name: 'Weeb3', url: '' }
            : { id: 'added-1', type, name: 'My Bee node', url: node },
        ]),
      );
      localStorage.setItem(
        'swarm-routing',
        JSON.stringify({
          mode: 'per-part',
          source: 'gateway',
          parts: { player: 'gateway', 'stream-list': 'gateway', previews: 'gateway', chat: 'added-1' },
        }),
      );
    },
    { node: MY_BEE_NODE, type: chatSource },
  );

  await page.goto(`/#/watch/video/${published.stream.owner}/${published.stream.topic}`);
  const chat = page.getByRole('region', { name: 'Chat', exact: true });
  await expect(
    page.getByRole('banner').getByRole('button', { name: startsSignedIn ? ACCOUNT_NAME : 'Connect', exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  if (startsSignedIn) {
    await expect(chat.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible({ timeout: 20_000 });
  }
  return { chat, toGateway, toMyNode, swarmId };
}

async function payWithMyStamp(page: Page, ownFeed = false) {
  await page.getByRole('banner').getByRole('button', { name: ACCOUNT_NAME }).click();
  const group = page.getByRole('dialog').getByRole('region', { name: 'Chat stamp' });
  await group.getByRole('radio', { name: /^My stamp/ }).check();
  await expect(group.getByText('Event chat')).toBeVisible();
  await expect(group.getByText('30 days left')).toBeVisible();
  await expect(group.getByText(/25% used/)).toBeVisible();
  if (ownFeed) {
    await group.getByRole('checkbox', { name: /Also write my own feed/ }).check();
  }
  await page.getByRole('button', { name: 'Close Connect', exact: true }).click();
}

/** Swarm ID's own button, inside its frame, in the part of the page that shows it. */
const swarmIdButton = (within: Locator, name: string) =>
  within.locator('iframe[title="Swarm ID"]').contentFrame().getByRole('button', { name, exact: true });

/** The page's own primary colour in the theme it wears, which Swarm ID's button is handed. */
const pagePrimary = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim());

const messageIn = (written: Written) =>
  parseChatMessage(new Uint8Array(written.body.subarray(SPAN_BYTES)), { origin: PREVIEW_ORIGIN, allowLocalHttp: true });

test('a message on my own stamp is stamped by Swarm ID and sent through my Bee node, never the gateway', async ({
  page,
}) => {
  const { chat, toGateway, toMyNode, swarmId } = await deployment(page, () => SITE_STAMP);
  await payWithMyStamp(page);

  await chat.getByRole('textbox', { name: 'Message', exact: true }).fill('on my own stamp');
  await chat.getByRole('button', { name: 'Send', exact: true }).click();

  await expect.poll(() => toMyNode.length, { message: 'the message reached my Bee node' }).toBeGreaterThan(0);
  expect(toGateway, 'nothing went to the event gateway').toEqual([]);
  expect(toMyNode[0].url.startsWith(`${MY_BEE_NODE}/soc/`)).toBe(true);
  expect(toMyNode[0].stamp, 'the stamp Swarm ID returned rides in the envelope header').toBe('ee'.repeat(113));
  expect(swarmId.stamped).toHaveLength(1);
  const check = messageIn(toMyNode[0]);
  expect(check.ok, check.ok ? '' : `${check.reason}: ${check.detail}`).toBe(true);
  expect(check.ok && check.message).toMatchObject({ text: 'on my own stamp', via: MessageVia.OWN_STAMP, own: false });
});

test('with the own feed on, the copy is written first and the message says it has one', async ({ page }) => {
  const { chat, toMyNode, swarmId } = await deployment(page, () => SITE_STAMP);
  await payWithMyStamp(page, true);

  await chat.getByRole('textbox', { name: 'Message', exact: true }).fill('kept in my own feed');
  await chat.getByRole('button', { name: 'Send', exact: true }).click();

  await expect.poll(() => toMyNode.length).toBeGreaterThanOrEqual(2);
  expect(swarmId.stamped[0].signer, 'the copy is signed by the chat key').toBe(CHAT_ADDRESS);
  expect(toMyNode[0].url.startsWith(`${MY_BEE_NODE}/soc/${CHAT_ADDRESS}/`)).toBe(true);
  const copy = messageIn(toMyNode[0]);
  const sent = messageIn(toMyNode[1]);
  expect(copy.ok && sent.ok).toBe(true);
  expect(sent.ok && sent.message).toMatchObject({ text: 'kept in my own feed', own: true });
  expect(toMyNode[0].body.equals(toMyNode[1].body), 'the copy is the message as it was sent').toBe(true);
});

test('a stamp that ran out holds the message, and the viewer may let the gateway pay', async ({ page }) => {
  const { chat, toGateway, toMyNode } = await deployment(page, () => ({ ...SITE_STAMP, utilization: 1 }));
  await page.getByRole('banner').getByRole('button', { name: ACCOUNT_NAME }).click();
  await page
    .getByRole('dialog')
    .getByRole('region', { name: 'Chat stamp' })
    .getByRole('radio', { name: /^My stamp/ })
    .check();
  await page.getByRole('button', { name: 'Close Connect', exact: true }).click();

  await expect(chat.getByText('Your stamp ran out.')).toBeVisible();
  await chat.getByRole('textbox', { name: 'Message', exact: true }).fill('waiting for a stamp');
  await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();

  await chat.getByRole('button', { name: 'Let the gateway pay', exact: true }).click();
  await chat.getByRole('button', { name: 'Send', exact: true }).click();

  await expect
    .poll(() => toGateway.length, { message: 'the gateway took it once the viewer said so' })
    .toBeGreaterThan(0);
  expect(toMyNode).toEqual([]);
  const check = messageIn(toGateway[0]);
  expect(check.ok && check.message).toMatchObject({ text: 'waiting for a stamp', via: MessageVia.GATEWAY });
});

test('a message on my own stamp with Weeb3 reading the chat is pushed through Weeb3, never to a Bee node or the gateway', async ({
  page,
}) => {
  const { chat, toGateway, toMyNode, swarmId } = await deployment(page, () => SITE_STAMP, 'weeb-3');
  await payWithMyStamp(page);

  await chat.getByRole('textbox', { name: 'Message', exact: true }).fill('through weeb-3');
  await chat.getByRole('button', { name: 'Send', exact: true }).click();

  await expect.poll(async () => (await weeb3Pushes(page)).length, { message: 'weeb-3 pushed it' }).toBeGreaterThan(0);
  const [pushed] = await weeb3Pushes(page);
  expect(toGateway, 'nothing went to the event gateway').toEqual([]);
  expect(toMyNode, 'nothing went to a Bee node').toEqual([]);
  expect(swarmId.stamped).toHaveLength(1);
  expect(pushed.soc).toBe(true);
  expect(pushed.stamp, 'the stamp Swarm ID returned, as its 113 bytes').toBe('ee'.repeat(113));
  const wrapped = Buffer.from(pushed.data, 'hex').subarray(32 + 65);
  const check = messageIn({ url: '', stamp: null, body: wrapped });
  expect(check.ok, check.ok ? '' : `${check.reason}: ${check.detail}`).toBe(true);
  expect(check.ok && check.message).toMatchObject({ text: 'through weeb-3', via: MessageVia.OWN_STAMP });
});

test("Sign in with Swarm ID is Swarm ID's own button, in the page's look, and its window signs the viewer in", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  const { swarmId } = await deployment(
    page,
    () => SITE_STAMP,
    'bee-node',
    () => {},
    false,
  );
  await page.getByRole('banner').getByRole('button', { name: 'Connect', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const button = swarmIdButton(dialog, 'Sign in with Swarm ID');
  await expect(button).toBeVisible();

  const frame = await dialog.locator('iframe[title="Swarm ID"]').boundingBox();
  const panel = await dialog.boundingBox();
  expect(frame && panel, 'the frame and the panel are both on screen').toBeTruthy();
  expect(frame!.width, 'as wide as its container lets it be').toBeGreaterThan(0);
  expect(frame!.x + frame!.width, 'inside the panel at phone width').toBeLessThanOrEqual(panel!.x + panel!.width);
  expect(frame!.x + frame!.width, 'inside the screen').toBeLessThanOrEqual(PHONE.width);

  await button.click();

  await expect(page.getByRole('banner').getByRole('button', { name: ACCOUNT_NAME })).toBeVisible();
  expect(swarmId.windows.opened).toBe(1);
  expect(swarmId.buttons[0]).toMatchObject({
    action: 'sign-in',
    config: { text: 'Sign in with Swarm ID', backgroundColor: await pagePrimary(page) },
  });
  const faces = swarmId.buttons[0].config.fontFaces as Array<{ family: string; url: string; weight: string }>;
  expect(faces, "the page's own font file for its typeface, at the bold the primary button uses").toHaveLength(1);
  expect(faces[0].weight).toBe('700');
  expect(faces[0].url.startsWith(`${PREVIEW_ORIGIN}/assets/`), faces[0].url).toBe(true);
  expect((await page.request.get(faces[0].url)).status(), 'the file the build emitted').toBe(200);
});

test("Swarm ID's button shows a placeholder of itself in its own place until its frame is ready, and nothing moves", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  const { swarmId } = await deployment(
    page,
    () => SITE_STAMP,
    'bee-node',
    () => {},
    false,
  );
  swarmId.holdButtons();
  await page.getByRole('banner').getByRole('button', { name: 'Connect', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const placeholder = dialog.locator('.swarm-id-button-placeholder');
  const frame = dialog.locator('iframe[title="Swarm ID"]');

  await expect(placeholder).toBeVisible();
  await expect(placeholder).toHaveText('Sign in with Swarm ID');
  await expect(dialog.getByRole('status').filter({ hasText: 'Connecting to Swarm ID' })).toBeAttached();
  await expect(frame).toBeAttached();
  const held = await placeholder.boundingBox();
  const fill = await placeholder.evaluate((element) => getComputedStyle(element).backgroundColor);
  const primary = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.backgroundColor = 'var(--color-primary)';
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  });
  expect(fill, "the page's primary fill").toBe(primary);

  swarmId.releaseButtons();
  await expect(placeholder).toHaveCount(0);
  const shown = await frame.boundingBox();
  expect(shown, 'the frame stands where the placeholder stood').toEqual(held);
  await expect(swarmIdButton(dialog, 'Sign in with Swarm ID')).toBeVisible();
});

test("a guest's Show it's really you row holds Swarm ID's button beside its words at phone width", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await deployment(
    page,
    () => SITE_STAMP,
    'bee-node',
    () => {},
    false,
  );
  await page.getByRole('banner').getByRole('button', { name: 'Connect', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Your name', exact: true }).fill('Ada');
  await dialog.getByRole('button', { name: 'Chat as guest', exact: true }).click();
  if (!(await dialog.isVisible())) {
    await page.getByRole('banner').getByRole('button', { name: /^Ada/ }).click();
  }
  await expect(swarmIdButton(dialog, 'Sign in with Swarm ID')).toBeVisible();

  const words = await dialog.getByText("Show it's really you", { exact: true }).boundingBox();
  const frame = await dialog.locator('iframe[title="Swarm ID"]').boundingBox();
  const panel = await dialog.boundingBox();
  expect(words && frame && panel, 'the words, the frame and the panel are on screen').toBeTruthy();
  expect(frame!.width, 'room for the button').toBeGreaterThan(100);
  expect(frame!.x + frame!.width, 'inside the panel').toBeLessThanOrEqual(panel!.x + panel!.width);
  expect(frame!.x + frame!.width, 'inside the screen').toBeLessThanOrEqual(PHONE.width);
  const besideOrBelow = frame!.x >= words!.x + words!.width || frame!.y >= words!.y + words!.height;
  expect(besideOrBelow, 'the button does not cover the words').toBe(true);
});

test("the compact Swarm ID button's placeholder shows its whole label on the narrowest phone", async ({ page }) => {
  await page.setViewportSize(NARROWEST_PHONE);
  const { swarmId } = await deployment(
    page,
    () => SITE_STAMP,
    'bee-node',
    () => {},
    false,
  );
  swarmId.holdButtons();
  await page.getByRole('banner').getByRole('button', { name: 'Connect', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Your name', exact: true }).fill('Ada');
  await dialog.getByRole('button', { name: 'Chat as guest', exact: true }).click();
  if (!(await dialog.isVisible())) {
    await page.getByRole('banner').getByRole('button', { name: /^Ada/ }).click();
  }
  const placeholder = dialog.locator('.compact > .swarm-id-button-placeholder');
  await expect(placeholder).toHaveText('Sign in with Swarm ID');

  const fits = await placeholder.evaluate((element) => element.scrollWidth <= element.clientWidth);
  expect(fits, 'the label is not cut off').toBe(true);
  const box = await placeholder.boundingBox();
  expect(box!.x + box!.width, 'inside the screen').toBeLessThanOrEqual(NARROWEST_PHONE.width);
});

test('Change stamp in Swarm ID opens the Swarm ID window again, and the stamp picked there shows at once', async ({
  page,
}) => {
  let stamp = SITE_STAMP;
  const { swarmId } = await deployment(
    page,
    () => stamp,
    'bee-node',
    () => {
      stamp = { ...SITE_STAMP, label: 'Picked in the window', utilization: 0.1, batchTTL: 12 * DAY_S };
    },
  );
  await page.getByRole('banner').getByRole('button', { name: ACCOUNT_NAME }).click();
  const group = page.getByRole('dialog').getByRole('region', { name: 'Chat stamp' });
  await group.getByRole('radio', { name: /^My stamp/ }).check();
  await expect(group.getByText('Event chat')).toBeVisible();

  await swarmIdButton(group, 'Change stamp in Swarm ID').click();

  await expect(group.getByText('Picked in the window')).toBeVisible();
  await expect(group.getByText('12 days left')).toBeVisible();
  await expect(group.getByText(/10% used/)).toBeVisible();
  expect(swarmId.windows.opened).toBe(1);
  await expect(page.getByRole('banner').getByRole('button', { name: ACCOUNT_NAME }), 'still signed in').toBeVisible();
});
