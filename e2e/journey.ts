import { expect, type BrowserContext, type Locator, type Page, type Route } from '@playwright/test';
import { DEFAULT_NOTE_SLOT_MS, noteAddress, noteSlotOf } from '@solarpunkltd/swarm-chat-js';

import { shortAddress } from '../src/shared/components/Address/addressText';

import { PREVIEW_ORIGIN, type Published, SMOKE_MESSAGE, SMOKE_USER } from './recording';

/** The codecs the event's streams are encoded with. A build without them loads every segment and shows nothing. */
const STREAM_CODECS = 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"';
/** Seconds of the recorded stream that must have played before playback counts as working. */
const PLAYED_SECONDS = 1;

/** A chat write is `POST {chat endpoint}/soc/{owner}/{identifier}`, which the page makes and nothing else. */
const CHAT_WRITE_PATH = /\/soc\/[0-9a-f]{40}\/[0-9a-f]{64}$/;

/** Hands every chat write the page makes to `handle`, and every other request on to the routes before it. */
export async function onChatWrite(page: Page, handle: (route: Route) => Promise<void>): Promise<void> {
  await page.route(
    (url) => CHAT_WRITE_PATH.test(url.pathname),
    (route) => (route.request().method() === 'POST' ? handle(route) : route.fallback()),
  );
}

/** Nothing leaves the page's own origin, so a request the recording does not hold can only fail the test. */
export async function refuseOtherOrigins(context: BrowserContext): Promise<void> {
  await context.route(
    (url) => url.origin !== PREVIEW_ORIGIN,
    (route) => route.abort('blockedbyclient'),
  );
}

/** Minutes either side of now whose slot notes a replay answers as absent, far longer than one journey takes. */
const NOTE_WINDOW_MINUTES = 15;

/**
 * Answers the chat's slot notes as absent, as a server that writes no notes would. A note's address depends on the
 * time it is read, so no recording can hold one, and an aborted read is a gateway failing rather than a note missing.
 * Every other request the recording does not hold still goes on to fail the journey.
 */
export async function answerSlotNotesAsAbsent(page: Page, chatTopic: string, feedOwner: string): Promise<void> {
  const now = noteSlotOf(Date.now(), DEFAULT_NOTE_SLOT_MS);
  const window = (NOTE_WINDOW_MINUTES * 60_000) / DEFAULT_NOTE_SLOT_MS;
  const notes = new Set<string>();
  for (let slot = now - window; slot <= now + window; slot++) {
    notes.add(noteAddress(chatTopic, DEFAULT_NOTE_SLOT_MS, slot, feedOwner).toHex());
  }
  await page.route(
    (url) => notes.has(url.pathname.split('/').pop() ?? ''),
    (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found","code":404}' }),
  );
}

export async function serveConfig(page: Page, config: unknown): Promise<void> {
  await page.route(`${PREVIEW_ORIGIN}/config.json`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify(config),
    }),
  );
}

/**
 * Opens the list, plays the recorded stream, reads its chat, joins and sends one message. The same steps record the
 * answers and replay them, so the recording holds exactly what the smoke test asks for.
 */
export async function watchAndChat(page: Page, published: Published): Promise<void> {
  await page.goto('/');
  const card = page.getByRole('link', { name: new RegExp(published.stream.title) });
  await expect(card, 'the finished stream is on the list').toBeVisible({ timeout: 20_000 });
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/watch/video/${published.stream.owner}/${published.stream.topic}`));

  const codecs = await page.evaluate((type) => MediaSource.isTypeSupported(type), STREAM_CODECS);
  expect(codecs, `this browser build cannot decode ${STREAM_CODECS}, so no stream would ever show a picture`).toBe(
    true,
  );
  await expect
    .poll(() => page.evaluate(() => document.querySelector('video')?.currentTime ?? 0), {
      message: `the stream plays past ${PLAYED_SECONDS} s`,
      timeout: 30_000,
    })
    .toBeGreaterThan(PLAYED_SECONDS);

  // Every name is matched exactly: Playwright matches a name as a substring by default, so "Message" also finds the
  // "Messages" list, and "Send" finds "Resend".
  const chat = page.getByRole('region', { name: 'Chat', exact: true });
  for (const text of published.chat.texts) {
    await expect(chat.getByText(text, { exact: true }), `the chat shows "${text}"`).toBeVisible({ timeout: 20_000 });
  }

  await badgesAndDetails(chat, published);

  await chat.getByRole('button', { name: 'Join the chat to send messages', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Your name', exact: true }).fill(SMOKE_USER);
  await page.getByRole('dialog').getByRole('button', { name: 'Chat as guest', exact: true }).click();
  await page.getByRole('button', { name: 'Close My Swarm', exact: true }).click();
  await chat.getByRole('textbox', { name: 'Message', exact: true }).fill(SMOKE_MESSAGE);
  await chat.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(chat.getByText(SMOKE_MESSAGE, { exact: true }), 'the sent message is shown').toBeVisible();
  await expect(chat.getByText('Not sent.'), 'the write was not refused').toHaveCount(0);
  await expect(
    chat
      .getByRole('listitem')
      .filter({ hasText: SMOKE_MESSAGE })
      .getByRole('button', { name: 'Guest, show details', exact: true }),
    "the viewer's own message carries the guest badge",
  ).toBeVisible();

  await allEmojiCloseShows(page, chat);
}

/** The field's whole emoji picker opens above the field, and its close button stays in sight beside it, never under it. */
async function allEmojiCloseShows(page: Page, chat: Locator): Promise<void> {
  await chat.getByRole('button', { name: 'Show all Emojis', exact: true }).click();
  const close = chat.getByRole('button', { name: 'Close the emoji picker', exact: true });
  await expect(close, 'the expanded picker has its close button').toBeVisible();
  const picker = chat.locator('.reaction-toolbar .EmojiPickerReact');
  await expect(picker.locator('input'), 'the expanded picker shows its search').toBeVisible();
  const [closeBox, pickerBox, chatBox] = await Promise.all([
    close.boundingBox(),
    picker.boundingBox(),
    chat.boundingBox(),
  ]);
  if (!closeBox || !pickerBox || !chatBox) {
    throw new Error('the picker, its close button or the chat has no box');
  }
  expect(closeBox.y + closeBox.height, 'the close button sits above the picker').toBeLessThanOrEqual(pickerBox.y);
  expect(closeBox.y, 'the close button is inside the chat').toBeGreaterThanOrEqual(chatBox.y);
  expect(pickerBox.y + pickerBox.height, 'the picker ends inside the chat').toBeLessThanOrEqual(
    chatBox.y + chatBox.height,
  );
  const onTop = await close.evaluate((button) => {
    const box = button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  });
  expect(onTop, 'nothing covers the close button').toBe(true);
  await close.click();
  await expect(close, 'the close button folds the picker back').toHaveCount(0);
}

/** Each message's badge says who vouched for its sender, and the badge opens what the page's check found. */
async function badgesAndDetails(chat: Locator, published: Published): Promise<void> {
  const row = (text: string) => chat.getByRole('listitem').filter({ hasText: text });
  const swarmId = row(published.chat.swarmId.text);
  const guest = row(published.chat.texts[0]);

  await expect(
    guest.getByRole('button', { name: 'Guest, show details', exact: true }),
    'a guest has the guest badge',
  ).toBeVisible();
  await expect(
    row(published.chat.ownStamp.text).getByRole('button', {
      name: "Sent with the sender's own stamp, show details",
      exact: true,
    }),
    'a message sent with its own stamp shows the stamp',
  ).toBeVisible();

  const actions = guest.locator('.message-actions');
  const opacity = () => actions.evaluate((bar) => getComputedStyle(bar).opacity);
  await expect.poll(opacity, { message: "a message's actions are hidden until the pointer is over it" }).toBe('0');
  await guest.hover();
  await expect.poll(opacity, { message: 'hovering a message reveals its actions' }).toBe('1');
  expect(await guest.evaluate((item) => getComputedStyle(item).cursor), 'a message shows it can be pressed').toBe(
    'pointer',
  );

  await swarmId.getByRole('button', { name: 'Swarm ID, show details', exact: true }).click();
  const details = swarmId.getByRole('region', { name: 'Details for this message', exact: true });
  await expect(details, 'the badge opens the details').toBeVisible();
  await chat.page().mouse.move(0, 0);
  await expect
    .poll(() => swarmId.locator('.message-actions').evaluate((bar) => getComputedStyle(bar).opacity), {
      message: "a click on the badge does not keep the message's actions once the pointer leaves",
    })
    .toBe('0');
  await expect(details).toContainText('Swarm ID');
  await details.getByRole('button', { name: shortAddress(published.chat.swarmId.account), exact: true }).click();
  await expect(details, 'the account expands to its full address').toContainText(published.chat.swarmId.account);
  await expect(details).toContainText('Event gateway');
  await details.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(details, 'the details close').toHaveCount(0);

  const ownStamp = row(published.chat.ownStamp.text);
  await ownStamp.getByRole('button', { name: "Sent with the sender's own stamp, show details", exact: true }).click();
  const stampDetails = ownStamp.getByRole('region', { name: 'Details for this message', exact: true });
  await expect(stampDetails, 'the stamp opens the details as the badge does').toBeVisible();
  await expect(stampDetails).toContainText('Own stamp');
  await stampDetails.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(stampDetails, 'the details close').toHaveCount(0);
}
