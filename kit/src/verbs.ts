import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrivateKey } from '@ethersphere/bee-js';
import { expect, type Page } from '@playwright/test';
import { MessageVia } from '@solarpunkltd/swarm-chat-js';

import { knowsBatch, waitFor } from './bee.ts';
import { ACCOUNT_CHECKS, ACCOUNT_VERBS, drivesOf, siteDriveOf } from './accountVerbs.ts';
import { chatFeedProblems } from './chatFeed.ts';
import { readChatFeed } from './chatFeedRead.ts';
import { CHAT_CHECKS, CHAT_VERBS } from './chatVerbs.ts';
import { SECURITY_CHECKS, SECURITY_VERBS } from './securityVerbs.ts';
import { findLeaks, searchProblems } from './leaks.ts';
import { traceTexts } from './traces.ts';
import { paidAsSentProblems, stampedRequests, stampsNamedToViewer } from './stampEvidence.ts';
import { CHAT_TIMEOUT_MS, CHOOSE_STAMP, expand, NO_STAMP_HOLD_MS, type Run, type Verb } from './run.ts';
import { chatRegion, chatStampGroup, closeConnect, idPage, openConnect, viewerPage } from './viewerPages.ts';
import { waitForSwarmIdButton } from './swarmIdButton.ts';
import { confirmInWindow, createDevDrive, DEV_DRIVE_DEPTH, openSealed, storedAccount } from './swarmIdPages.ts';

/** A real outside address, whose name resolves on the open network, for the browser guard's control. */
const GUARD_CONTROL_URL = 'https://example.com/';
/** What Chromium says when a name does not resolve, which the guard's resolver rule makes every outside name do. */
const NAME_NOT_RESOLVED = 'ERR_NAME_NOT_RESOLVED';

const verbs: Record<string, Verb> = {
  /**
   * `send "text" [--stamp mine]`: types and sends a chat message, and waits until the chat has read it back from the
   * feed, which is when the page stops saying Sending.
   */
  async send(run, step) {
    const actor = run.actor(step.actor!);
    const page = await viewerPage(run, actor);
    const text = expand(run, step.args[0] ?? '');
    if (!text) throw new Error('send needs the text to send');
    const ownStamp = step.options.stamp === 'mine';
    const drive = ownStamp ? siteDriveOf(run, actor) : undefined;
    if (ownStamp && !drive) throw new Error('send --stamp mine needs a drive picked for the viewer earlier in the run');
    const chat = chatRegion(page);
    await chat.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
    await chat.getByRole('button', { name: 'Send', exact: true }).click();
    const row = chat.getByRole('listitem').filter({ hasText: text });
    await expect(row, `"${text}" is shown`).toBeVisible({ timeout: CHAT_TIMEOUT_MS });
    // A message waiting to be read back says Sending, and after a while Not confirmed yet, so both have to be gone.
    await expect(row.getByText(/^(Sending…|Not confirmed yet\.)/), `"${text}" is read back`).toHaveCount(0, {
      timeout: CHAT_TIMEOUT_MS,
    });
    await expect(row.getByText('Not sent.'), `"${text}" was not refused`).toHaveCount(0);
    run.sent.push({
      actor: actor.name,
      text,
      via: ownStamp ? MessageVia.OWN_STAMP : MessageVia.GATEWAY,
      ...(actor.session === 'guest' ? { guest: true } : {}),
      ...(drive ? { drive } : {}),
    });
  },

  /**
   * `buy-drive depth=20`: a real batch on the local chain, through Swarm ID's `/dev` page, owned by the account's own
   * postage signer. Waits until the viewer's own Bee node knows the batch, since it refuses a chunk stamped with one
   * it has not seen.
   */
  async 'buy-drive'(run, step) {
    const actor = run.actor(step.actor!);
    const depth = Number(step.options.depth ?? DEV_DRIVE_DEPTH);
    if (depth !== DEV_DRIVE_DEPTH)
      throw new Error(`/dev buys depth ${DEV_DRIVE_DEPTH} only, and the kit has no verb for a paid drive`);
    const page = await idPage(run, actor);
    const batchID = await actor.untraced(async () => {
      const created = await createDevDrive(page, run.addresses.swarmId);
      await page.goto(`${run.addresses.swarmId}/`);
      return created;
    });
    const stamp = (await storedAccount(page))?.postageStamps?.find((s) => s.batchID === batchID);
    if (stamp?.signerKey) {
      run.secrets.set(`${actor.name} stamp key`, await actor.untraced(() => openSealed(page, stamp.signerKey)));
    }
    await waitFor('the viewer’s own node to know the batch', () => knowsBatch(run.addresses.worker2, batchID), {
      timeoutMs: 180_000,
      intervalMs: 5000,
    });
    run.findings[`${actor.name} drive`] = { batchID, depth };
    run.findings[`${actor.name} drives`] = [...drivesOf(run, actor), batchID];
  },

  /**
   * `choose-stamp mine|gateway [--pick drive]`: picks who pays in Connect's Chat stamp group. With `--pick drive`, My
   * stamp also needs the person's pick: the viewer must offer Choose a stamp in Swarm ID, and the drive bought in this
   * run is picked and confirmed in the Swarm ID window. Without it nothing is confirmed in Swarm ID.
   */
  async 'choose-stamp'(run, step) {
    const actor = run.actor(step.actor!);
    const page = await viewerPage(run, actor);
    const dialog = await openConnect(page);
    const group = chatStampGroup(dialog);
    if (step.args[0] === 'gateway') {
      await group.getByRole('radio', { name: /^Gateway pays/ }).check();
      await closeConnect(page);
      return;
    }
    if (step.args[0] !== 'mine') throw new Error('choose-stamp takes mine or gateway');
    const pick = step.options.pick;
    if (pick !== undefined && pick !== 'drive') throw new Error('choose-stamp mine picks with --pick drive only');
    await group.getByRole('radio', { name: /^My stamp/ }).check();
    if (pick === undefined) {
      await closeConnect(page);
      return;
    }
    const drive = (run.findings[`${actor.name} drive`] as { batchID: string } | undefined)?.batchID;
    if (!drive) throw new Error('--pick drive needs a drive bought earlier in the run');
    const choose = await waitForSwarmIdButton(run, group, CHOOSE_STAMP);
    const popupOpened = page.waitForEvent('popup', { timeout: 30_000 });
    await choose.click();
    await confirmInWindow(await popupOpened, actor.password, actor, drive);
    await expect(group.getByText(/days left/)).toBeVisible({ timeout: CHAT_TIMEOUT_MS });
    await expect(group.getByText(/% used/)).toBeVisible();
    run.findings[`${actor.name} site drive`] = drive;
    await closeConnect(page);
  },
};

/** The viewer's Chat stamp group and its chat say the site has no stamp, and offer the way to choose one. */
async function expectNoStampShown(run: Run, page: Page): Promise<void> {
  const group = chatStampGroup(await openConnect(page));
  await expect(group.getByRole('radio', { name: /^My stamp/ })).toBeChecked();
  await expect(group.getByText('Swarm ID has given this site no stamp yet.', { exact: false })).toBeVisible({
    timeout: CHAT_TIMEOUT_MS,
  });
  await waitForSwarmIdButton(run, group, CHOOSE_STAMP);
  await expect(group.getByText(/days left/)).toHaveCount(0);
  await closeConnect(page);
  // The bar's words are its live region and Swarm ID's button sits beside them, so the bar is found by its words.
  const warning = chatRegion(page)
    .locator('.stamp-warning')
    .filter({ has: page.getByRole('status').filter({ hasText: 'No stamp for this site.' }) });
  await expect(warning).toBeVisible({ timeout: CHAT_TIMEOUT_MS });
  await waitForSwarmIdButton(run, warning, CHOOSE_STAMP);
}

const checks: Record<string, Verb> = {
  /**
   * `expect chat-feed`: the chat feed, read from Bee, holds every message the run sent, each signed by its sender
   * and vouched for by Swarm ID, each saying it was paid the way it was sent, and, once the browsers closed, each
   * actor's recorded network holding an inbox write to the gateway for each gateway send and one to their own node
   * stamped with the drive picked for the site at the time of each own-stamp send, counted per drive, with no inbox
   * write on a drive no send was to spend.
   */
  async 'chat-feed'(run, step) {
    const entries = await readChatFeed(run);
    run.findings['chat feed'] = entries;
    const problems = chatFeedProblems(entries, run.sent, run.id);
    if (problems.length) throw new Error(problems.join('; '));
    const places = {
      viewer: run.addresses.viewer,
      gateway: run.addresses.gateway,
      ownNode: run.addresses.worker2,
      inboxOwner: new PrivateKey(run.state.gsocKey).publicKey().address().toHex(),
    };
    for (const actor of run.actors) {
      const mine = run.sent.filter((message) => message.actor === actor.name);
      if (!mine.length) continue;
      const ownStamp: Record<string, number> = {};
      for (const { drive } of mine.filter((message) => message.via === MessageVia.OWN_STAMP)) {
        ownStamp[drive!] = (ownStamp[drive!] ?? 0) + 1;
      }
      const sends = { gateway: mine.filter((message) => message.via === MessageVia.GATEWAY).length, ownStamp };
      // The recording is written when the browser closes, so how each message was paid is read from it then.
      run.afterClose.push({
        step: step.line,
        check: async () => {
          const har = readFileSync(join(actor.dir, 'network.har'), 'utf8');
          const paid = paidAsSentProblems(har, places, sends);
          run.findings[`${actor.name} paid as sent`] = { sends, problems: paid };
          if (paid.length) throw new Error(`${actor.name}: ${paid.join('; ')}`);
        },
      });
    }
  },

  /**
   * `expect outside-blocked <actor>`: the browser guard's control. The viewer's page asks for an outside https address
   * and the request is stopped by the actor's routing, and a page of the same browser with no routing at all cannot
   * resolve that address's name, so a request that slipped past the routing would reach nothing either.
   */
  async 'outside-blocked'(run, step) {
    const actor = run.actor(step.args[1]);
    const page = await viewerPage(run, actor);
    const request = `GET ${GUARD_CONTROL_URL}`;
    run.guardControls.add(request);
    const fetched = await page.evaluate(
      (url) =>
        fetch(url, { mode: 'no-cors' }).then(
          () => 'answered',
          (error: unknown) => String(error),
        ),
      GUARD_CONTROL_URL,
    );
    if (fetched === 'answered') throw new Error(`${GUARD_CONTROL_URL} answered the viewer's page`);
    await expect
      .poll(() => actor.blocked.includes(request), { message: 'the routing stopped the request', timeout: 10_000 })
      .toBe(true);
    const unrouted = await actor.context.browser()!.newContext();
    try {
      const failed = await (await unrouted.newPage()).goto(GUARD_CONTROL_URL).then(
        () => 'loaded',
        (error: unknown) => String(error),
      );
      run.findings[`${actor.name} guard control`] = { routed: fetched, unrouted: failed };
      if (!failed.includes(NAME_NOT_RESOLVED)) {
        throw new Error(`with no routing, ${GUARD_CONTROL_URL} was not refused by its name: ${failed}`);
      }
    } finally {
      await unrouted.close();
    }
  },

  /**
   * `expect no-wallet-link "text"`: the message the chat feed holds with that text carries no wallet link, read from
   * Bee and verified as a reader verifies it.
   */
  async 'no-wallet-link'(run, step) {
    const text = expand(run, step.args[1] ?? '');
    if (!text) throw new Error(`${step.line} names no message`);
    const entry = (await readChatFeed(run, { atLeast: 1, texts: [text] })).find(
      (candidate) => candidate.ok && candidate.text === text,
    );
    if (!entry?.ok) throw new Error(`the chat feed does not hold "${text}"`);
    run.findings[`wallet in "${text}"`] = entry.wallet ?? null;
    if (entry.wallet) throw new Error(`"${text}" carries a wallet link naming ${entry.wallet}`);
  },

  /**
   * `expect frames-partitioned <actor>`: Swarm ID's frames in the viewer write to storage apart from Swarm ID's own,
   * as a browser keeps two sites apart, measured on the live stack the way the fork's `expectProxyPartitioned`
   * measures it.
   */
  async 'frames-partitioned'(run, step) {
    const actor = run.actor(step.args[1]);
    const page = await viewerPage(run, actor);
    const frame = page.frames().find((candidate) => candidate.url().startsWith(run.addresses.swarmId));
    if (!frame) throw new Error('the viewer holds no Swarm ID frame');
    const key = `__flow-kit-partition-${run.id}`;
    await frame.evaluate((name) => localStorage.setItem(name, 'written in the frame'), key);
    const firstParty = await actor.context.newPage();
    await firstParty.goto(`${run.addresses.swarmId}/`);
    const seen = await firstParty.evaluate((name) => localStorage.getItem(name), key);
    await firstParty.close();
    run.findings['frames partitioned'] = seen === null;
    if (seen !== null)
      throw new Error(
        'the Swarm ID frame shares Swarm ID’s own storage, so this run is not the path a real browser takes',
      );
  },

  /**
   * `expect no-key-leak <actor>`: neither the account key nor the stamp key, nor the password, is anywhere the
   * viewer's page could reach: its page, its storage, what its window was sent, its console, or any request or answer
   * of the actor's browser. The page and storage are read now, the recorded network once the browser has closed.
   */
  async 'no-key-leak'(run, step) {
    const actor = run.actor(step.args[1]);
    const secrets = Object.fromEntries([...run.secrets].filter(([name]) => name.startsWith(`${actor.name} `)));
    if (!Object.keys(secrets).some((name) => name.endsWith('stamp key'))) {
      throw new Error('no stamp key was made for this actor, so there is nothing to look for');
    }
    const page = await viewerPage(run, actor);
    const texts: Record<string, string> = {
      'the viewer page': await page.content(),
      'the viewer storage': await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
      'what the viewer window was sent': await actor.received(),
    };
    const pageLeaks = findLeaks(texts, secrets);
    const drive = (run.findings[`${actor.name} drive`] as { batchID: string } | undefined)?.batchID;
    run.afterClose.push({
      step: step.line,
      check: async () => {
        const consoleFile = join(actor.dir, 'console.log');
        const viewerLines = existsSync(consoleFile)
          ? readFileSync(consoleFile, 'utf8')
              .split('\n')
              .filter((line) => line.split(' ')[2]?.startsWith(run.addresses.viewer))
          : [];
        const har = readFileSync(join(actor.dir, 'network.har'), 'utf8');
        const traces = traceTexts(actor.dir);
        const recorded = { 'the recorded network': har, 'the viewer console': viewerLines.join('\n'), ...traces };
        const unsearched = drive ? searchProblems(har, traces, drive) : ['no drive was bought, so nothing is public'];
        if (unsearched.length) throw new Error(unsearched.join('; '));
        const leaks = [...pageLeaks, ...findLeaks(recorded, secrets)];
        run.findings[`${actor.name} key leaks`] = {
          looked: Object.keys(secrets),
          in: [...Object.keys(texts), ...Object.keys(recorded)],
          found: leaks,
        };
        if (leaks.length) throw new Error(`found ${leaks.join(', ')}`);
      },
    });
  },

  /**
   * `expect site-drive <actor>`: Swarm ID's frame in the viewer named to the viewer the drive picked for it, so a later
   * check that another site got no stamp is made while the person holds a stamp a site could be handed.
   */
  async 'site-drive'(run, step) {
    const actor = run.actor(step.args[1]);
    const drive = siteDriveOf(run, actor);
    if (!drive) throw new Error('no drive was picked for the viewer, so there is nothing the frame could name');
    await expect
      .poll(async () => stampsNamedToViewer(await actor.received()).at(-1), {
        message: 'the viewer is told of the drive picked for it',
        timeout: CHAT_TIMEOUT_MS,
      })
      .toBe(drive);
  },

  /**
   * `expect no-site-stamp <actor>`: Swarm ID gave the viewer no stamp, though the actor's account has a drive. The
   * viewer says so and offers Choose a stamp in Swarm ID, in Connect and above the chat, and keeps saying so for a
   * while, sending is held with a message typed, Swarm ID's frame never named the drive to the viewer, and once the
   * browser has closed, no request of the viewer's page or of the Swarm ID frames in it carried a postage stamp.
   */
  async 'no-site-stamp'(run, step) {
    const actor = run.actor(step.args[1]);
    const drive = (run.findings[`${actor.name} drive`] as { batchID: string } | undefined)?.batchID;
    if (!drive) throw new Error('no drive was bought for this actor, so a missing stamp proves nothing');
    const page = await viewerPage(run, actor);
    await expectNoStampShown(run, page);
    await page.waitForTimeout(NO_STAMP_HOLD_MS);
    await expectNoStampShown(run, page);

    const chat = chatRegion(page);
    await chat.getByRole('textbox', { name: 'Message', exact: true }).fill(`held ${run.id}`);
    await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();

    const named = stampsNamedToViewer(await actor.received());
    run.findings[`${actor.name} stamps named to the viewer`] = named;
    if (!named.length) throw new Error('Swarm ID’s frame named nothing to the viewer, so its silence proves nothing');
    if (named.includes(drive)) throw new Error('Swarm ID’s frame named the drive to the viewer without a pick');

    run.afterClose.push({
      step: step.line,
      check: async () => {
        const har = readFileSync(join(actor.dir, 'network.har'), 'utf8');
        // The control: the chat history is read from the viewer's own node, so a recording without a request there
        // recorded nothing, and its silence about stamps would mean nothing.
        if (!har.includes(run.addresses.worker2)) {
          throw new Error('the recorded network holds no request to the viewer’s own node, so it proves nothing');
        }
        const { viewerPages, stamped } = stampedRequests(har, run.addresses.viewer, [drive]);
        if (!viewerPages) throw new Error('the recorded network holds no viewer page, so it proves nothing');
        run.findings[`${actor.name} stamped requests`] = stamped;
        if (stamped.length) throw new Error(`requests carried a postage stamp: ${stamped.join(', ')}`);
      },
    });
  },
};

export const VERBS = new Map(Object.entries({ ...verbs, ...ACCOUNT_VERBS, ...CHAT_VERBS, ...SECURITY_VERBS }));
export const CHECKS = new Map(Object.entries({ ...checks, ...CHAT_CHECKS, ...ACCOUNT_CHECKS, ...SECURITY_CHECKS }));
