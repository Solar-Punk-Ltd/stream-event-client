/**
 * The verbs and checks of the viewer's chat side: where the chat is read from, joining as a guest, a message's
 * details, and the own feed's count and Sync in My stamp, with a fault that makes the own feed's copies fail.
 */
import { expect, type Locator, type Page, type Route } from '@playwright/test';

import { claimServiceWorkerControl, FAKE_WEEB3, serveFakeWeeb3 } from '../../e2e/fakeWeeb3.ts';
import type { Actor } from './actors.ts';
import { localStack, ownNodeOf } from './deployment.ts';
import { ensNameFor } from './liveEns.ts';
import { CHAT_TIMEOUT_MS, expand, type Run, type Verb } from './run.ts';
import type { Step } from './scenario.ts';
import { banner, chatRegion, chatStampGroup, closeConnect, openConnect, viewerPage } from './viewerPages.ts';

/** How many times the viewer tries one own feed copy before it gives the copy up, as the release does. */
const OWN_COPY_ATTEMPTS = 3;
const SOURCE_NAMES = { bee: 'My Bee node', weeb3: 'Weeb3', gateway: 'Event gateway' } as const;
/** Sync copies one message after another, each tried a few times, so a long sync takes a while. */
const SYNC_TIMEOUT_MS = 120_000;

/** A message's row in an actor's chat, found by its text. */
function messageRow(page: Page, text: string): Locator {
  return chatRegion(page).getByRole('listitem').filter({ hasText: text }).last();
}

function messageText(run: Run, step: Step, at = 1): string {
  const text = expand(run, step.args[at] ?? '');
  if (!text) throw new Error(`${step.line} names no message`);
  return text;
}

/**
 * The name a scenario means by `ens:<actor>`, the actor's ENS name, which is the baked one locally and the target's live,
 * `chosen:<actor>` or a name written out.
 */
function expectedName(run: Run, written: string): string {
  const [kind, who] = written.split(':');
  if (kind === 'ens' && who) return ensNameFor(run, who);
  if (kind === 'chosen') {
    const name = run.actor(who).chatName;
    if (!name) throw new Error(`${who} has no chat name yet`);
    return name;
  }
  return expand(run, written);
}

/** The details card of a message, opened from its badge when it is not open yet. */
async function openDetails(page: Page, text: string): Promise<Locator> {
  const row = messageRow(page, text);
  await expect(row, `"${text}" is shown`).toBeVisible({ timeout: CHAT_TIMEOUT_MS });
  const card = row.getByRole('region', { name: 'Details for this message' });
  if (!(await card.isVisible()))
    await row
      .getByRole('button', { name: /, show details$/ })
      .first()
      .click();
  await expect(card).toBeVisible();
  return card;
}

/** The value a details card shows under a label, such as `Identity` or `Sent`. */
function detail(card: Locator, label: string): Locator {
  return card.locator(`dt:text-is("${label}") + dd`);
}

/** Whether a request writes a single-owner chunk to the own node at an address other than the chat's inbox. */
function isOwnFeedCopy(run: Run, actor: Actor, request: { method(): string; url(): string }): boolean {
  if (request.method() !== 'POST') return false;
  const url = new URL(request.url());
  if (url.origin !== new URL(ownNodeOf(run, actor.name)).origin) return false;
  const owner = url.pathname.match(/^\/soc\/([0-9a-fA-F]{40})\//)?.[1]?.toLowerCase();
  return owner !== undefined && owner !== run.deployment.inboxOwner;
}

/** The faults an actor's browser carries now, by name, so a verb can take one away again. */
const faults = new WeakMap<Actor, { route: (route: Route) => Promise<void>; refused: number }>();

async function addSource(dialog: Locator, kind: 'bee' | 'weeb3', address: string): Promise<void> {
  await dialog.getByRole('button', { name: 'Add source', exact: true }).click();
  await dialog.getByRole('button', { name: new RegExp(`^${SOURCE_NAMES[kind]}`) }).click();
  if (kind === 'weeb3') {
    await dialog.getByRole('button', { name: 'Add Weeb3', exact: true }).click();
    return;
  }
  await dialog.getByLabel('Address', { exact: true }).fill(address);
  await dialog.getByLabel('Name', { exact: true }).fill(SOURCE_NAMES.bee);
  await dialog.getByRole('button', { name: 'Test connection', exact: true }).click();
  const add = dialog.getByRole('button', { name: 'Add node', exact: true });
  await expect(add, 'the node passes every check').toBeEnabled({ timeout: CHAT_TIMEOUT_MS });
  await add.click();
}

async function useForChat(dialog: Locator, sourceName: string): Promise<void> {
  const useFor = dialog.getByRole('region', { name: 'Use for' });
  await useFor.getByRole('button', { name: 'Per feature', exact: true }).click();
  await useFor.getByLabel('Chat history', { exact: true }).selectOption({ label: sourceName });
}

export const CHAT_VERBS: Record<string, Verb> = {
  /**
   * `connect-source bee|gateway|weeb3`: picks where the chat history is read from, and so what a message on the
   * person's own stamp is sent through, in My Swarm. bee adds the viewer's own node, worker-2 locally and live the
   * tunnel the target names for the actor, through Add source and its checks. weeb3 adds the viewer's existing fake of
   * the in-browser node, since the real one joins the public network, and the verdict names it as a fake, so it runs
   * locally only. gateway goes back to the event's gateway.
   */
  async 'connect-source'(run, step) {
    const actor = run.actor(step.actor!);
    const kind = step.args[0];
    if (kind !== 'bee' && kind !== 'gateway' && kind !== 'weeb3') {
      throw new Error('connect-source takes bee, gateway or weeb3');
    }
    if (kind === 'weeb3') localStack(run, 'connect-source weeb3');
    let page = await viewerPage(run, actor);
    if (kind === 'weeb3') {
      await claimServiceWorkerControl(page);
      await serveFakeWeeb3(page, FAKE_WEEB3);
      await page.reload();
      run.findings.fakes = [...new Set([...((run.findings.fakes as string[] | undefined) ?? []), 'weeb3'])];
      page = actor.viewer!;
    }
    const dialog = await openConnect(page);
    const row = dialog.locator('[data-source-row]', { hasText: SOURCE_NAMES[kind] });
    if (kind !== 'gateway' && !(await row.isVisible()))
      await addSource(dialog, kind, kind === 'bee' ? ownNodeOf(run, actor.name) : '');
    await useForChat(dialog, SOURCE_NAMES[kind]);
    await closeConnect(page);
  },

  /**
   * `reload`: loads the viewer's page again, as a person would, which drops everything the page kept in memory, such as
   * a count of the own feed made a while ago, and keeps what it stored, such as the sources and who pays.
   */
  async reload(run, step) {
    const actor = run.actor(step.actor!);
    const page = await viewerPage(run, actor);
    await page.reload();
    await expect(chatRegion(page)).toBeVisible({ timeout: CHAT_TIMEOUT_MS });
  },

  /** `guest "name"`: asks to chat as a guest with that name. Whether the viewer took it is for an `expect` to say. */
  async guest(run, step) {
    const actor = run.actor(step.actor!);
    const name = messageText(run, step, 0);
    const page = await viewerPage(run, actor);
    const dialog = await openConnect(page);
    await dialog.getByRole('textbox', { name: 'Your name' }).fill(name);
    // Typing clears the last refusal, so `expect name-refused` after this click reads this name's refusal, never one left
    // from the name before.
    await expect(dialog.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Chat as guest', exact: true }).click();
    const left = await dialog
      .getByRole('button', { name: 'Leave', exact: true })
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (left) {
      actor.session = 'guest';
      actor.chatName = (await banner(page).locator('.connect-button-name').innerText()).trim();
      await closeConnect(page);
    }
  },

  /** `read-details "text"`: opens the details of a message the actor sees, from its badge. */
  async 'read-details'(run, step) {
    const actor = run.actor(step.actor!);
    const text = messageText(run, step, 0);
    const card = await openDetails(await viewerPage(run, actor), text);
    const shown = (run.findings[`${actor.name} details`] as Record<string, string> | undefined) ?? {};
    run.findings[`${actor.name} details`] = { ...shown, [text]: await card.innerText() };
  },

  /**
   * `fail-copies on|off`: on, the actor's browser refuses every write of a copy into their own feed, which leaves the
   * message itself alone. off waits until a copy was refused as often as the viewer tries one, so the copy was given
   * up, and lets copies through again.
   */
  async 'fail-copies'(run, step) {
    const actor = run.actor(step.actor!);
    if (step.args[0] === 'on') {
      const fault = {
        refused: 0,
        route: async (route: Route) => {
          if (!isOwnFeedCopy(run, actor, route.request())) return route.fallback();
          fault.refused++;
          return route.abort('failed');
        },
      };
      faults.set(actor, fault);
      await actor.context.route(`${ownNodeOf(run, actor.name)}/soc/**`, fault.route);
      return;
    }
    if (step.args[0] !== 'off') throw new Error('fail-copies takes on or off');
    const fault = faults.get(actor);
    if (!fault) throw new Error('fail-copies off needs fail-copies on before it');
    await expect
      .poll(() => fault.refused, { message: 'a copy was refused every time it was tried', timeout: CHAT_TIMEOUT_MS })
      .toBeGreaterThanOrEqual(OWN_COPY_ATTEMPTS);
    await actor.context.unroute(`${ownNodeOf(run, actor.name)}/soc/**`, fault.route);
    run.findings[`${actor.name} copies refused`] = fault.refused;
    faults.delete(actor);
  },

  /** `sync`: Sync in My stamp's own feed line, waiting until it says every copy was made or which could not be. */
  async sync(run, step) {
    const actor = run.actor(step.actor!);
    const page = await viewerPage(run, actor);
    const line = chatStampGroup(await openConnect(page)).getByRole('group', { name: 'Own feed in this chat' });
    await expect(line.getByRole('button', { name: 'Sync', exact: true })).toBeVisible({ timeout: CHAT_TIMEOUT_MS });
    await line.getByRole('button', { name: 'Sync', exact: true }).click();
    const outcome = line.getByRole('status').filter({ hasText: /copied$/ });
    await expect(outcome).toBeVisible({ timeout: SYNC_TIMEOUT_MS });
    run.findings[`${actor.name} sync`] = await outcome.innerText();
    await closeConnect(page);
  },
};

export const CHAT_CHECKS: Record<string, Verb> = {
  /** `expect sees <actor> "text"`: the message shows in that actor's chat. */
  async sees(run, step) {
    const page = await viewerPage(run, run.actor(step.args[1]));
    await expect(messageRow(page, messageText(run, step, 2))).toBeVisible({ timeout: CHAT_TIMEOUT_MS });
  },

  /**
   * `expect sender <actor> "text" name=<ens:who|chosen:who|written> badge=swarm-id|guest [stamp=own|gateway]
   * [ens=shown|none]`: the sender line the actor sees above a message: the name, the badge, the own stamp mark for a
   * message on the sender's own stamp, and whether the name is shown as an ENS name.
   */
  async sender(run, step) {
    const page = await viewerPage(run, run.actor(step.args[1]));
    const row = messageRow(page, messageText(run, step, 2));
    await expect(row).toBeVisible({ timeout: CHAT_TIMEOUT_MS });
    const line = row.locator('.chat-message-sender');
    if (step.options.name) {
      await expect(line.locator('.chat-message-name')).toHaveText(expectedName(run, step.options.name), {
        timeout: CHAT_TIMEOUT_MS,
      });
    }
    if (step.options.badge) {
      const badge = step.options.badge === 'swarm-id' ? 'Swarm ID' : 'Guest';
      await expect(line.getByRole('button', { name: `${badge}, show details`, exact: true })).toBeVisible();
    }
    if (step.options.stamp) {
      const mark = line.getByRole('button', { name: 'Sent with their own stamp, show details', exact: true });
      await expect(mark).toHaveCount(step.options.stamp === 'own' ? 1 : 0);
    }
    // The name is marked as an ENS name by this class alone, so `shown` is the control that `none` looks in the right place.
    if (step.options.ens === 'none') await expect(line.locator('.ens-name')).toHaveCount(0);
    if (step.options.ens === 'shown') await expect(line.locator('.ens-name')).toBeVisible({ timeout: CHAT_TIMEOUT_MS });
  },

  /**
   * `expect details <actor> "text" [identity=swarm-id|guest] [sent=own|gateway] [ens=<who>|none] [own-feed=N]
   * [chat-feed=N] [in-own-feed=yes|no]`: what the message's details card says. ens names the actor whose baked name
   * must show with the ENS checked tick, the baked name locally and the target's live, and the sender's chosen name, or none for no ENS row.
   */
  async details(run, step) {
    const card = await openDetails(await viewerPage(run, run.actor(step.args[1])), messageText(run, step, 2));
    const { identity, sent, ens } = step.options;
    if (identity) await expect(detail(card, 'Identity')).toHaveText(identity === 'swarm-id' ? 'Swarm ID' : 'Guest');
    if (sent) await expect(detail(card, 'Sent')).toHaveText(sent === 'own' ? 'Own stamp' : 'Event gateway');
    if (ens === 'none') await expect(card.locator('dt:text-is("ENS")')).toHaveCount(0);
    else if (ens) {
      const row = detail(card, 'ENS');
      await expect(row.locator('.message-details-ens-name bdi')).toHaveText(expectedName(run, `ens:${ens}`), {
        timeout: CHAT_TIMEOUT_MS,
      });
      await expect(row.getByRole('img', { name: 'ENS name checked' })).toBeVisible();
      await expect(row).toContainText(`Chosen name ${expectedName(run, `chosen:${ens}`)}`);
    }
    const ownFeed = card.getByRole('region', { name: 'Own feed' });
    const count = (n: string) => (n === '1' ? '1 message' : `${n} messages`);
    if (step.options['own-feed']) {
      await expect(ownFeed.getByText(`Own feed: ${count(step.options['own-feed'])}`, { exact: true })).toBeVisible({
        timeout: CHAT_TIMEOUT_MS,
      });
    }
    if (step.options['chat-feed']) {
      await expect(
        ownFeed.getByText(`Chat feed: ${count(step.options['chat-feed'])} on their own stamp`, { exact: true }),
      ).toBeVisible({ timeout: CHAT_TIMEOUT_MS });
    }
    if (step.options['in-own-feed']) {
      const words = step.options['in-own-feed'] === 'yes' ? 'In their own feed' : 'Not in their own feed';
      await expect(ownFeed.getByText(words, { exact: true })).toBeVisible({ timeout: CHAT_TIMEOUT_MS });
    }
  },

  /**
   * `expect own-feed-line <actor> copied=N total=M [missing=K]`: My stamp's line about the actor's own feed in this
   * chat, "Own feed: N of M messages", and "K missing" while copies are missing.
   */
  async 'own-feed-line'(run, step) {
    const page = await viewerPage(run, run.actor(step.args[1]));
    const line = chatStampGroup(await openConnect(page)).getByRole('group', { name: 'Own feed in this chat' });
    const total = step.options.total === '1' ? '1 message' : `${step.options.total} messages`;
    await expect(line.getByText(/^Own feed:/)).toBeVisible({ timeout: CHAT_TIMEOUT_MS });
    const seen = (run.findings['own feed lines'] as string[] | undefined) ?? [];
    run.findings['own feed lines'] = [...seen, `${step.line}: ${(await line.innerText()).replace(/\s+/g, ' ')}`];
    await expect(line.getByText(`Own feed: ${step.options.copied} of ${total}`, { exact: true })).toBeVisible({
      timeout: CHAT_TIMEOUT_MS,
    });
    if (step.options.missing) {
      await expect(line.getByText(`${step.options.missing} missing`, { exact: true })).toBeVisible();
    }
    await closeConnect(page);
  },

  /** `expect name-refused <actor>`: the guest name was refused, with the reason shown, and the actor is not chatting. */
  async 'name-refused'(run, step) {
    const actor = run.actor(step.args[1]);
    const page = await viewerPage(run, actor);
    const dialog = await openConnect(page);
    const problem = dialog.getByRole('alert').filter({ hasText: /\S/ });
    await expect(problem, 'the viewer says why the name is refused').toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Chat as guest', exact: true })).toBeVisible();
    const refused = (run.findings[`${actor.name} names refused`] as string[] | undefined) ?? [];
    run.findings[`${actor.name} names refused`] = [...refused, await problem.innerText()];
    if (actor.session !== null) throw new Error(`${actor.name} chats although the name was refused`);
  },

  /** `expect joined <actor>`: the actor chats, as a guest or signed in. */
  async joined(run, step) {
    const actor = run.actor(step.args[1]);
    if (actor.session === null) throw new Error(`${actor.name} does not chat`);
    const page = await viewerPage(run, actor);
    await expect(chatRegion(page).getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  },
};
