/**
 * The security set's verbs and checks. The browser-driven ones open the hostile site in the acting actor's own context,
 * since a person is signed into the viewer and the hostile site in one browser, and a site's keys live in the account
 * that context holds. The forging and replay verbs write raw to the chat's GSOC inbox from the kit's process, so the
 * chat server's checks are attacked directly. Nothing here relaxes an expected result to pass: a result that does not
 * hold is a finding, and its scenario is marked known at the step that reproduces it.
 */
import { Bee, Identifier, PrivateKey } from '@ethersphere/bee-js';
import { expect, type Page } from '@playwright/test';
import { keccak256, toBytes } from 'viem';

import type { Actor } from './actors.ts';
import { readChatFeed } from './chatFeedRead.ts';
import { deviceFeedExposure, readDeviceFeedAsOutsider } from './deviceFeed.ts';
import {
  forgedWalletLinkMessage,
  foreignBindingMessage,
  guestMessage,
  tamperedMessage,
  wrongAddressMessage,
  type WalletLinkFlaw,
} from './forge.ts';
import { healthStatus } from './bee.ts';
import { localStack } from './deployment.ts';
import { bareHex } from './hex.ts';
import { lyingReverseAnswer } from './lyingRpc.ts';
import { CHAT_TIMEOUT_MS, expand, type Run, type Verb } from './run.ts';
import { countProblems, countsOf, type ExpectedCounts, replayOutcome, type ServerCounts } from './serverCounts.ts';
import { frameIdentity } from './stampEvidence.ts';
import { isAllowListRefusal, isNoDriveRefusal } from './swarmIdRefusals.ts';
import { confirmInWindow, NO_DRIVE, storedAccount, thisDeviceId } from './swarmIdPages.ts';
import { closeConnect, idPage, openConnect, viewerPage } from './viewerPages.ts';
import { swarmIdButton, waitForSwarmIdButton } from './swarmIdButton.ts';

/** The hostile site's small surface, as its page puts it on `window`. */
interface EvilApi {
  init: { ok: boolean; error?: string };
  info(): { identity: string | null; hasBinding: boolean };
  chatKey(): Promise<string>;
  batch(): Promise<string | null>;
  stamp(): Promise<{ stamped: boolean; error?: string }>;
}

/** The hostile site as the kit drives it: its page, how its start went, and the calls it makes to Swarm ID. */
interface EvilSite {
  page: Page;
  init: { ok: boolean; error?: string };
  chatKey(): Promise<string>;
  batch(): Promise<string | null>;
  stamp(): Promise<{ stamped: boolean; error?: string }>;
}

/** What a forging step wrote to the inbox, so the check after it knows exactly what the server must have counted. */
interface Forged extends ExpectedCounts {
  /** Every text the forged messages carried, none of which may reach the chat feed. */
  texts: string[];
}

const FORGED = 'forged writes';
const COUNTS_BEFORE = 'server counts before';
/** The name the lying endpoint gives every wallet, a well-known one, so a viewer that shows it is plainly fooled. */
const LYING_NAME = 'vitalik.eth';
/** How long the replay waits for the second write to be counted before it reads that Bee kept it back. */
const REPLAY_SETTLE_MS = 30_000;

/** A 0x key made for the run from a label, public by construction, for a forged binding, wallet link or signer. */
function forgeHex(run: Run, label: string): `0x${string}` {
  return keccak256(toBytes(`flow-kit ${run.id} ${label}`));
}

/** The same key as a bee-js PrivateKey, for a message the forge signs directly. */
function forgeKey(run: Run, label: string): PrivateKey {
  return new PrivateKey(forgeHex(run, label).slice(2));
}

/**
 * A batch id for a write through a gateway that stamps chat writes itself and replaces the one it is sent. Bee refuses
 * a write with no batch id, so something well formed goes. It is the value the chat library sends, which it keeps
 * private.
 */
const GATEWAY_STAMPS_ITSELF = '0123456789abcdef'.repeat(4);

/**
 * Writes a payload straight to the chat's one GSOC inbox address, signed with the mined key every sender shares.
 * Locally it goes to a Bee node with the kit's own stamp. Live it goes to the deployment's chat write address, the
 * path every guest message takes, where the gateway stamps it with its own batch, so the kit holds no stamp.
 */
async function writeToInbox(run: Run, payload: Uint8Array): Promise<void> {
  if (run.live) {
    const bee = new Bee(run.live.chatWrite);
    const signer = new PrivateKey(run.live.inbox.key);
    const identifier = Identifier.fromString(run.live.inbox.identifier);
    await bee.messaging.gsocSend(GATEWAY_STAMPS_ITSELF, signer, identifier, payload, { deferred: false });
    return;
  }
  const { addresses, state } = localStack(run, 'a raw inbox write');
  const bee = new Bee(addresses.worker1);
  const signer = new PrivateKey(state.gsocKey);
  const identifier = Identifier.fromString(state.gsocIdentifier);
  await bee.messaging.gsocSend(state.stamps.gateway, signer, identifier, payload, { deferred: false });
}

/**
 * The chat server's counts of messages received and dropped by reason, now. Live they are read through the operator's
 * tunnel, which the live gate has checked before the run.
 */
async function serverCounts(run: Run): Promise<ServerCounts> {
  const address = run.live ? run.live.chatHealth : localStack(run, "the chat server's counts").addresses.chatServer;
  if (!address) throw new Error("the target names no chatHealth, so the chat server's counts cannot be read");
  const counts = countsOf((await healthStatus(address)).body);
  if (!counts) throw new Error('the chat server reports no count of messages received');
  return counts;
}

/** The bare address of a chat key given as hex, which is a site's chat address. */
function addressOf(keyHex: string): string {
  return bareHex(new PrivateKey(bareHex(keyHex)).publicKey().address().toHex());
}

function evil(run: Run, actor: Actor): EvilSite {
  if (!actor.evilPage || actor.evilPage.isClosed()) throw new Error(`${actor.name} has not visited the hostile site`);
  const page = actor.evilPage;
  return {
    page,
    get init() {
      return run.findings[`${actor.name} evil init`] as { ok: boolean; error?: string };
    },
    chatKey: () => page.evaluate(() => (window as unknown as { __evil: EvilApi }).__evil.chatKey()),
    batch: () => page.evaluate(() => (window as unknown as { __evil: EvilApi }).__evil.batch()),
    stamp: () => page.evaluate(() => (window as unknown as { __evil: EvilApi }).__evil.stamp()),
  };
}

/** Whether a call the hostile site makes to Swarm ID is answered or refused, as one word for a poll. */
const answered = (call: Promise<unknown>) =>
  call.then(
    () => 'answered' as const,
    () => 'refused' as const,
  );

/**
 * The Swarm ID the hostile site embeds. Locally the unlisted check takes the strict build, whose allow list leaves the
 * hostile site out. Live, the real Swarm ID's allow list does not name a site served from this machine, so the unlisted
 * check takes it as it is, and no hostile site is ever put on the real list.
 */
function swarmIdForEvil(run: Run, listing: string): string {
  if (listing !== 'unlisted' && listing !== 'allowed') throw new Error('evil visit takes allowed or unlisted');
  if (!run.local) {
    if (listing === 'allowed')
      throw new Error('evil visit allowed needs the local stack, the real allow list never names the hostile site');
    return run.addresses.swarmId;
  }
  return listing === 'unlisted' ? run.local.addresses.swarmIdStrict : run.addresses.swarmId;
}

async function evilVisit(run: Run, actor: Actor, listing: string): Promise<void> {
  const swarmId = swarmIdForEvil(run, listing);
  const query = new URLSearchParams({ swarmId, app: 'Hostile site' });
  const page = await actor.context.newPage();
  actor.evilPage = page;
  await page.goto(`${run.addresses.evil}/?${query.toString()}`);
  await page.waitForFunction(() => '__evil' in window, undefined, { timeout: CHAT_TIMEOUT_MS });
  const init = await page.evaluate(() => (window as unknown as { __evil: EvilApi }).__evil.init);
  run.findings[`${actor.name} evil init`] = init;
}

/** The label of the connect window's choice to give a site no drive. */

/**
 * Signs the account in to the hostile site through its Swarm ID button. The connect window offers a new site the
 * account default drive, and its confirm gives the site that drive, so `none` picks No drive there instead, as a
 * person who does not mean to pay for the site does.
 */
async function evilSignIn(run: Run, actor: Actor, drive: string | undefined): Promise<void> {
  if (drive !== undefined && drive !== 'none') throw new Error('evil sign-in takes --drive none only');
  const page = evil(run, actor).page;
  const button = await waitForSwarmIdButton(run, page.locator('#signin'), 'Sign in with Swarm ID');
  const popup = page.waitForEvent('popup', { timeout: 30_000 });
  await button.click();
  await confirmInWindow(await popup, actor.password, actor, drive === 'none' ? NO_DRIVE : undefined);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __evil: EvilApi }).__evil.info().identity), {
      message: 'the hostile site becomes signed in',
      timeout: CHAT_TIMEOUT_MS,
    })
    .not.toBeNull();
}

/** The account id and its opened derivation key the kit holds for an actor, for the device-feed read. */
function accountSecrets(run: Run, actor: Actor): { derivationKey: string } {
  const derivationKey = run.secrets.get(`${actor.name} account key`);
  if (!derivationKey) throw new Error(`${actor.name} has no opened account key, so the device feed cannot be read`);
  return { derivationKey };
}

export const SECURITY_VERBS: Record<string, Verb> = {
  /**
   * `evil visit allowed|unlisted`, `evil sign-in [--drive none]`, `evil replay "text"`, `evil forge message|wallet-link|binding`,
   * `evil read-device-feed`: the hostile site's actions, in the acting actor's context, or raw inbox writes from the
   * kit's process for the forging and replay ones.
   */
  async evil(run, step) {
    const actor = run.actor(step.actor!);
    const action = step.args[0];
    const topic = run.deployment.chatTopic;
    switch (action) {
      case 'visit':
        return evilVisit(run, actor, step.args[1]);
      case 'sign-in':
        return evilSignIn(run, actor, step.options.drive);
      case 'reload': {
        const page = evil(run, actor).page;
        await page.reload();
        await page.waitForFunction(() => '__evil' in window, undefined, { timeout: CHAT_TIMEOUT_MS });
        run.findings[`${actor.name} evil init`] = await page.evaluate(
          () => (window as unknown as { __evil: EvilApi }).__evil.init,
        );
        return;
      }
      case 'replay':
        return evilReplay(run, expand(run, step.args[1] ?? ''), topic);
      case 'forge':
        return evilForge(run, actor, step.args[1], topic);
      case 'read-device-feed': {
        const account = await storedAccount(await idPage(run, actor));
        if (!account?.id) throw new Error('no account to read a device feed for');
        const listed = (account.devices ?? []).filter((device) => !device.removedAt).map((device) => device.deviceId);
        const devices = [...new Set([...listed, ...(await thisDeviceId(await idPage(run, actor)))])];
        const reads = await readDeviceFeedAsOutsider(
          run,
          actor.name,
          accountSecrets(run, actor).derivationKey,
          account.id,
          devices,
        );
        run.findings[`${actor.name} device feed`] = reads;
        return;
      }
      default:
        throw new Error(`evil: unknown action ${action}`);
    }
  },

  /**
   * `rpc down|lie|honest`: sets how the actor's browser's Ethereum endpoint answers. `down` refuses every call, so no
   * name can be read. `lie` answers ENS's reverse lookup of every wallet with a false name whose records name the wallet
   * back, and leaves every other call to the chain. `honest` lets the chain answer again. Each call the setting
   * answered is counted, for `expect rpc-answered`.
   */
  async rpc(run, step) {
    const actor = run.actor(step.actor!);
    const mode = step.args[0];
    const ethereum = new URL(run.live ? run.live.ensRpc : localStack(run, 'rpc').addresses.ethereum).origin;
    const onEthereum = (url: URL) => url.origin === ethereum;
    const counted = `${actor.name} rpc answered`;
    run.findings[counted] = 0;
    const count = () => {
      run.findings[counted] = (run.findings[counted] as number) + 1;
    };
    await actor.context.unroute(onEthereum);
    if (mode === 'down') {
      // A JSON-RPC error on every call, which viem treats as a failed read. An empty '0x' result decoded differently
      // under load, so the answer is an unambiguous refusal.
      await actor.context.route(onEthereum, (route) => {
        count();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'endpoint down' } }),
        });
      });
    } else if (mode === 'lie') {
      await actor.context.route(onEthereum, async (route) => {
        let body: unknown;
        try {
          body = route.request().postDataJSON();
        } catch {
          return route.continue();
        }
        const calls = Array.isArray(body) ? body : [body];
        const lies = calls.map((call) => lyingReverseAnswer(call, LYING_NAME));
        if (lies.every((lie) => lie === null)) return route.continue();
        count();
        if (!Array.isArray(body)) return route.fulfill({ json: lies[0] });
        const truth = (await (await route.fetch()).json()) as unknown[];
        return route.fulfill({ json: truth.map((answer, index) => lies[index] ?? answer) });
      });
    } else if (mode !== 'honest') {
      throw new Error('rpc takes down, lie or honest');
    }
    run.findings[`${actor.name} rpc`] = mode;
  },

  /** `revoke evil`: removes the hostile site from the account, on the Apps screen, so its session is cut off. */
  async revoke(run, step) {
    const actor = run.actor(step.actor!);
    if (step.args[0] !== 'evil') throw new Error('revoke knows the hostile site only');
    const page = await idPage(run, actor);
    await page.goto(`${run.addresses.swarmId}/#apps/${encodeURIComponent(run.addresses.evil)}`);
    const row = page.locator('[aria-current="true"]');
    await expect(row, 'the hostile site is listed among the apps').toBeVisible({ timeout: CHAT_TIMEOUT_MS });
    await row.getByRole('button', { name: 'App actions' }).click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await expect(page.getByText(`${run.addresses.evil} is not connected`, { exact: false })).toBeVisible({
      timeout: CHAT_TIMEOUT_MS,
    });
  },
};

/**
 * Writes one guest message, waits until the server has published it, then writes the identical bytes again, and reads
 * from the server's counts whether the repeat reached it and was dropped as a duplicate, or never reached it at all.
 */
async function evilReplay(run: Run, text: string, topic: string): Promise<void> {
  if (!text) throw new Error('evil replay needs the text to write twice');
  const payload = guestMessage(forgeKey(run, 'replay'), topic, text);
  const before = await serverCounts(run);
  await writeToInbox(run, payload);
  await readChatFeed(run, { atLeast: 1, texts: [text] });
  await writeToInbox(run, payload);
  let after = await serverCounts(run);
  const deadline = Date.now() + REPLAY_SETTLE_MS;
  while (after.received - before.received < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    after = await serverCounts(run);
  }
  run.findings['replay'] = { text, before, after, ...replayOutcome(before, after) };
}

/** Records what a forging step wrote, for `expect server-dropped`. */
function recordForged(run: Run, forged: Forged): void {
  run.findings[FORGED] = forged;
}

async function evilForge(run: Run, actor: Actor, kind: string, topic: string): Promise<void> {
  const text = `forged ${kind} ${run.id}`;
  if (kind === 'message') {
    const claimed = frameIdentity(await actor.received())?.chatAddress;
    if (!claimed)
      throw new Error(`${actor.name} has no chat address the viewer was told of, so there is none to claim`);
    const wrong = `wrong addr ${run.id}`;
    const tampered = `tampered ${run.id}`;
    await writeToInbox(run, wrongAddressMessage(forgeKey(run, 'claim'), topic, wrong, claimed));
    await writeToInbox(run, tamperedMessage(forgeKey(run, 'tamper'), topic, tampered));
    recordForged(run, {
      received: 2,
      dropped: { signature: 2 },
      texts: [wrong, tampered, `${tampered} tampered`],
    });
    run.findings[`${actor.name} forged`] =
      `a message claiming ${actor.name}'s chat address ${claimed}, and a tampered body`;
    return;
  }
  if (kind === 'binding') {
    const payload = await foreignBindingMessage({
      topic,
      text,
      otherSite: OTHER_SITE,
      accountKey: forgeHex(run, 'account'),
      chatKey: forgeHex(run, 'chat'),
    });
    await writeToInbox(run, payload);
    recordForged(run, { received: 1, dropped: { binding: 1 }, texts: [text] });
    run.findings[`${actor.name} forged`] = `a binding for ${OTHER_SITE}`;
    return;
  }
  if (kind === 'wallet-link') {
    const flaws: WalletLinkFlaw[] = ['high-s', 'wrong-wallet', 'another-account'];
    for (const flaw of flaws) {
      const payload = await forgedWalletLinkMessage({
        topic,
        text: `${text} ${flaw}`,
        site: run.addresses.viewer,
        accountKey: forgeHex(run, 'account'),
        chatKey: forgeHex(run, `chat-${flaw}`),
        wallet: forgeHex(run, 'wallet'),
        otherWallet: forgeHex(run, 'other'),
        flaw,
      });
      await writeToInbox(run, payload);
    }
    recordForged(run, {
      received: flaws.length,
      dropped: { binding: flaws.length },
      texts: flaws.map((flaw) => `${text} ${flaw}`),
    });
    run.findings[`${actor.name} forged`] = 'wallet links with a high-s, a wrong wallet and another account';
    return;
  }
  throw new Error('evil forge takes message, wallet-link or binding');
}

/** A loopback http origin other than the viewer's, for a binding the server must reject as a foreign site. */
const OTHER_SITE = 'http://localhost:4180';

export const SECURITY_CHECKS: Record<string, Verb> = {
  /**
   * `expect evil-refused <actor>`: Swarm ID refused the hostile site because its allow list does not serve it, in the
   * fork's own words for that site, so its client never started and it was issued no key. Any other failure to start
   * proves nothing about the allow list.
   */
  async 'evil-refused'(run, step) {
    const api = evil(run, run.actor(step.args[1]));
    if (api.init.ok) throw new Error('the hostile site was not refused by Swarm ID');
    if (!isAllowListRefusal(api.init.error, run.addresses.evil)) {
      throw new Error(`the hostile site failed to start, but not by the allow list: ${api.init.error ?? 'no error'}`);
    }
    await expect.poll(() => answered(api.chatKey()), { timeout: CHAT_TIMEOUT_MS }).toBe('refused');
  },

  /**
   * `expect evil-site-key <actor> "text"`: the hostile site holds its own chat key, different from the account id and
   * from the viewer's chat address for the same account, which is the message named by "text" in the chat feed. The
   * control: Swarm ID's frame in the viewer reported that same chat address and account to the viewer, so the message
   * compared against is the viewer's own. Every address is compared bare and in lower case.
   */
  async 'evil-site-key'(run, step) {
    const actor = run.actor(step.args[1]);
    const api = evil(run, actor);
    const evilAddress = addressOf(await api.chatKey());
    const stored = (await storedAccount(await idPage(run, actor)))?.id;
    const account = stored ? bareHex(stored) : undefined;
    const viewerText = expand(run, step.args[2] ?? '');
    const entry = (await readChatFeed(run, { atLeast: 1, texts: [viewerText] })).find(
      (candidate) => candidate.ok && candidate.text === viewerText,
    );
    if (!entry?.ok) throw new Error(`the chat feed does not hold the viewer message "${viewerText}"`);
    const viewer = bareHex(entry.addr);
    const frame = frameIdentity(await actor.received());
    run.findings[`${actor.name} site keys`] = { evil: evilAddress, viewer, account, frame };
    if (!frame?.chatAddress || frame.chatAddress !== viewer) {
      throw new Error(
        `the viewer's frame reported chat address ${frame?.chatAddress ?? 'none'}, not the message's ${viewer}`,
      );
    }
    if (!account || frame.account !== account || bareHex(entry.account ?? '') !== account) {
      throw new Error('the viewer message is not bound to the account the frame reported');
    }
    if (evilAddress === viewer) throw new Error('the hostile site and the viewer share a chat address');
    if (evilAddress === account) throw new Error('the hostile site holds the account key as its chat key');
  },

  /**
   * `expect evil-no-stamp <actor>`: Swarm ID gave the hostile site no stamp and refused to stamp a chunk for it, in its
   * own words for a site with no drive, so it cannot spend the person's drive.
   */
  async 'evil-no-stamp'(run, step) {
    const api = evil(run, run.actor(step.args[1]));
    const batch = await api.batch();
    const stamp = await api.stamp();
    run.findings[`${step.args[1]} evil stamp`] = { batch, stamp };
    if (batch) throw new Error(`the hostile site was given a stamp: ${batch}`);
    if (stamp.stamped) throw new Error('Swarm ID stamped a chunk for the hostile site');
    if (!isNoDriveRefusal(stamp.error)) {
      throw new Error(
        `the stamp attempt failed, but not as Swarm ID's refusal of a site with no drive: ${stamp.error}`,
      );
    }
  },

  /** `expect evil-authenticated <actor>`: the hostile site's authenticated calls to Swarm ID are answered. */
  async 'evil-authenticated'(run, step) {
    const api = evil(run, run.actor(step.args[1]));
    await expect
      .poll(() => answered(api.chatKey()), { message: 'the hostile site is answered', timeout: CHAT_TIMEOUT_MS })
      .toBe('answered');
  },

  /** `expect evil-cut-off <actor>`: after a revoke, the hostile site's authenticated calls to Swarm ID are refused. */
  async 'evil-cut-off'(run, step) {
    const api = evil(run, run.actor(step.args[1]));
    await expect
      .poll(() => answered(api.chatKey()), {
        message: 'the revoked hostile site loses its session',
        timeout: CHAT_TIMEOUT_MS,
      })
      .toBe('refused');
  },

  /**
   * `expect window-blocked <actor>`: the viewer's Swarm ID sign-in button, clicked under a popup blocker, opens no
   * window, and the page says the window was blocked and offers Try again, with no half session left behind.
   */
  async 'window-blocked'(run, step) {
    const actor = run.actor(step.args[1]);
    const page = await viewerPage(run, actor);
    const dialog = await openConnect(page);
    const button = await waitForSwarmIdButton(run, dialog, 'Sign in with Swarm ID');
    const opened = page.waitForEvent('popup', { timeout: 8000 }).then(
      () => true,
      () => false,
    );
    await button.click();
    run.findings[`${actor.name} popup opened`] = await opened;
    if (await opened) throw new Error('a window opened, so the popup blocker is off and this proves nothing');
    await expect(page.getByText('Your browser blocked the Swarm ID window.')).toBeVisible({ timeout: CHAT_TIMEOUT_MS });
    await expect(swarmIdButton(dialog, 'Sign in with Swarm ID')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
    await closeConnect(page);
  },

  /** `expect published-once "text"`: the chat feed holds the message exactly once, however often it was written. */
  async 'published-once'(run, step) {
    const text = expand(run, step.args[1] ?? '');
    const held = (await readChatFeed(run, { atLeast: 1, texts: [text] })).filter(
      (entry) => entry.ok && entry.text === text,
    );
    run.findings[`published "${text}"`] = held.length;
    if (held.length !== 1) throw new Error(`the chat feed holds "${text}" ${held.length} times, not once`);
  },

  /**
   * `expect replay-closed`: the repeat of `evil replay` was not taken as new, either because the server received it
   * and dropped it as a duplicate, or because Bee never handed the identical chunk over a second time. Which of the two
   * is recorded, so the result says what closed the replay.
   */
  async 'replay-closed'(run) {
    const replay = run.findings['replay'] as { outcome?: string; problem?: string } | undefined;
    if (!replay) throw new Error('replay-closed needs `evil replay` first');
    if (replay.problem) throw new Error(replay.problem);
  },

  /**
   * `expect server-dropped <actor> reasons=a,b`: since `snapshot-drops`, the chat server received every forged write
   * and dropped each for the reason it was forged for, exactly as many times, with the named reasons the only ones
   * that rose. The chat feed, read after, holds none of the forged texts, verified or not.
   */
  async 'server-dropped'(run, step) {
    const reasons = (step.options.reasons ?? '').split(',').filter(Boolean);
    if (!reasons.length) throw new Error('server-dropped needs reasons=<a,b>');
    const before = run.findings[COUNTS_BEFORE] as ServerCounts | undefined;
    if (!before) throw new Error('server-dropped needs `snapshot-drops` before the forging step');
    const forged = run.findings[FORGED] as Forged | undefined;
    if (!forged) throw new Error('server-dropped needs a forging step after `snapshot-drops`');
    const forgedReasons = Object.keys(forged.dropped).sort();
    if (forgedReasons.join(',') !== [...reasons].sort().join(',')) {
      throw new Error(`the step forged for ${forgedReasons.join(', ')}, not for ${reasons.join(', ')}`);
    }
    let after = before;
    await expect
      .poll(
        async () => {
          after = await serverCounts(run);
          return after.received - before.received >= forged.received;
        },
        { message: 'the server receives every forged write', timeout: CHAT_TIMEOUT_MS },
      )
      .toBe(true);
    run.findings['server counts after'] = after;
    const problems = countProblems(before, after, forged);
    if (problems.length) throw new Error(problems.join('; '));

    const feed = await readChatFeed(run, { atLeast: 0, texts: [] });
    const published = feed.filter((entry) => entry.text !== undefined && forged.texts.includes(entry.text));
    run.findings['forged texts in the feed'] = { read: feed.length, found: published.map((entry) => entry.index) };
    if (published.length)
      throw new Error(`the chat feed holds forged messages at ${published.map((entry) => entry.index).join(', ')}`);
  },

  /**
   * `expect rpc-answered <actor>`: the endpoint setting `rpc` made answered at least one call, so the scenario's result
   * comes from it and not from a page that never asked.
   */
  async 'rpc-answered'(run, step) {
    const count = (run.findings[`${step.args[1]} rpc answered`] as number | undefined) ?? 0;
    if (count < 1) throw new Error(`the ${String(run.findings[`${step.args[1]} rpc`])} endpoint answered no call`);
  },

  /**
   * `expect device-feed-clean <actor>`: the account's device feed, read from Swarm as an outsider would, opens nothing:
   * no pointer carries the key to its state, and no state it opened holds an app secret or a signer key.
   */
  async 'device-feed-clean'(run, step) {
    const reads = run.findings[`${step.args[1]} device feed`] as Parameters<typeof deviceFeedExposure>[0] | undefined;
    if (!reads) throw new Error('read the device feed first with `evil read-device-feed`');
    const exposed = deviceFeedExposure(reads);
    if (exposed.length) throw new Error(`the device feed exposes ${exposed.join(', ')}`);
  },
};

/** `snapshot-drops <actor>`: records the server's counts, so a later `server-dropped` sees exactly what rose. */
SECURITY_VERBS['snapshot-drops'] = async (run) => {
  run.findings[COUNTS_BEFORE] = await serverCounts(run);
};
