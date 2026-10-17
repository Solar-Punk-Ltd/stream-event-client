import { expect, type Locator, type Page } from '@playwright/test';

import type { Actor } from './actors.ts';
import { CHAT_TIMEOUT_MS, type Run } from './run.ts';

export const banner = (page: Page) => page.getByRole('banner');
/** My Swarm's own button in the banner, named My Swarm before anyone chats and by the chat name after. */
const connectButton = (page: Page) => banner(page).locator('button[aria-haspopup="dialog"]');
export const chatRegion = (page: Page) => page.getByRole('region', { name: 'Chat', exact: true });
export const chatStampGroup = (dialog: Locator) => dialog.getByRole('region', { name: 'Chat stamp' });
export async function idPage(run: Run, actor: Actor): Promise<Page> {
  if (!actor.idPage || actor.idPage.isClosed()) actor.idPage = await actor.context.newPage();
  return actor.idPage;
}

/** Opens the watch page of the kit's stream, where the chat is. */
export async function viewerPage(run: Run, actor: Actor): Promise<Page> {
  if (actor.viewer && !actor.viewer.isClosed()) return actor.viewer;
  actor.viewer = await actor.context.newPage();
  const { owner, topic } = run.state.stream;
  await actor.viewer.goto(`${run.addresses.viewer}/#/watch/video/${owner}/${topic}`);
  await expect(chatRegion(actor.viewer)).toBeVisible({ timeout: CHAT_TIMEOUT_MS });
  return actor.viewer;
}

/** Opens My Swarm from the banner, whatever the banner button says for who is signed in. */
export async function openConnect(page: Page): Promise<Locator> {
  const dialog = page.getByRole('dialog');
  if (!(await dialog.isVisible())) await connectButton(page).click();
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function closeConnect(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: 'Close My Swarm', exact: true });
  if (await close.isVisible()) await close.click();
}
