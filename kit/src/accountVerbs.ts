/**
 * The verbs of a person's Swarm ID account: making one with a password, a passkey or a wallet, signing in to the
 * viewer and out again, the wallet link behind "Show my ENS name on sites", and changing the site's stamp.
 */
import { randomBytes } from 'node:crypto';

import { expect, type Page } from '@playwright/test';
import type { Hex } from 'viem';

import type { Actor } from './actors.ts';
import { localStack } from './deployment.ts';
import { bakedWalletKey, ENS_ACTORS, type EnsActor } from './ens.ts';
import { installVirtualAuthenticator } from './passkey.ts';
import { CHAT_TIMEOUT_MS, type Run, type Verb } from './run.ts';
import { stampsNamedToViewer, type WalletLinkSeen } from './stampEvidence.ts';
import {
  completeCreateFlow,
  confirmAccessWithPasskey,
  confirmAccessWithWallet,
  confirmInWindow,
  NO_DRIVE,
  openSealed,
  giveEverySiteNoDrive,
  signInWithPhrase,
  storedAccount,
  toAccessStep,
} from './swarmIdPages.ts';
import type { StandingAccount } from './liveAccounts.ts';
import { banner, chatRegion, chatStampGroup, closeConnect, idPage, openConnect, viewerPage } from './viewerPages.ts';
import { swarmIdButton, waitForSwarmIdButton } from './swarmIdButton.ts';
import { pickInjectedWallet, testWallet } from './wallet.ts';
import { ensLinkWaitMs, watchWalletLink } from './walletLinkWatch.ts';

const SIGN_IN = 'Sign in with Swarm ID';
const CHANGE_STAMP = 'Change stamp in Swarm ID';
const ENS_SETTING = 'Show my ENS name on sites';
/** The local chain's dev faucet funds a wallet with this much, in wei, before the wallet first pays. */
const WALLET_FUNDS = `0x${(10n ** 19n).toString(16)}`;

/** The drive the actor last picked for the viewer in Swarm ID's window, which a send on their own stamp spends. */
export function siteDriveOf(run: Run, actor: Actor): string | undefined {
  return run.findings[`${actor.name} site drive`] as string | undefined;
}

/** Every drive bought for an actor in this run, oldest first. */
export function drivesOf(run: Run, actor: Actor): string[] {
  return (run.findings[`${actor.name} drives`] as string[] | undefined) ?? [];
}

async function readSecrets(run: Run, actor: Actor, page: Page): Promise<void> {
  const sealedKey = (await storedAccount(page))?.derivationKey;
  if (sealedKey) run.secrets.set(`${actor.name} account key`, await actor.untraced(() => openSealed(page, sealedKey)));
}

/** Funds a wallet on the local Gnosis chain, as the dev faucet would, so it can pay where a flow asks it to. */
async function fund(run: Run, address: Hex): Promise<void> {
  const answer = await fetch(localStack(run, 'funding a wallet').addresses.chain, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'anvil_setBalance', params: [address, WALLET_FUNDS] }),
  });
  const body = (await answer.json()) as { error?: { message: string } };
  if (body.error) throw new Error(`funding the wallet failed: ${body.error.message}`);
}

/**
 * Which wallet an actor's wallet account uses: a new one, or with a name the wallet that owns the actor's ENS name,
 * which is the one the snapshot baked locally and the target's, its key read from the environment, live.
 */
function walletFor(run: Run, actor: Actor, named: boolean) {
  if (!named) return testWallet(`0x${randomBytes(32).toString('hex')}`);
  if (run.live) {
    const owner = run.live.target.ens?.actor;
    if (!run.ensWallet || owner !== actor.name) {
      throw new Error(`live mode has the ENS wallet for ${owner ?? 'nobody'}, not ${actor.name}`);
    }
    return run.ensWallet;
  }
  if (!ENS_ACTORS.includes(actor.name as EnsActor)) {
    throw new Error(`the ENS snapshot names wallets for ${ENS_ACTORS.join(' and ')} only, not ${actor.name}`);
  }
  return testWallet(bakedWalletKey(actor.name as EnsActor));
}

/**
 * Live, an actor the scenario gives a drive signs in to their standing account from its phrase instead of making one,
 * secured in this browser with its password, and the account must be the one the target names, holding every drive the
 * target names. The one change made is to give the sites an earlier run left on the account's Apps screen no drive,
 * because a site keeps the drive it was given, and every scenario starts from a site that has none. The drives stay
 * attached and no site is removed.
 */
async function signInToStanding(run: Run, actor: Actor, page: Page, standing: StandingAccount): Promise<void> {
  const { phrase, password } = standing.credentials;
  run.secrets.set(`${actor.name} recovery phrase`, phrase);
  run.secrets.set(`${actor.name} password`, password);
  actor.password = password;
  await signInWithPhrase(page, phrase, password, actor);
  const account = await storedAccount(page);
  const address = `0x${(account?.id ?? '').replace(/^0x/i, '')}`.toLowerCase();
  const attached = (account?.postageStamps ?? []).map((stamp) => stamp.batchID);
  const missing = standing.drives.filter((drive) => !attached.includes(drive));
  if (address !== standing.address.toLowerCase() || missing.length) {
    throw new Error(
      `the phrase signed in to ${address}, holding the drives ${attached.join(', ') || 'none'}, and the target names ${standing.address} with ${standing.drives.join(', ')}`,
    );
  }
  const sitesGivenNoDrive = await giveEverySiteNoDrive(page, run.addresses.swarmId);
  run.findings[`${actor.name} standing account`] = { address, drives: attached, sitesGivenNoDrive };
  await readSecrets(run, actor, page);
}

/** Notes who the viewer now shows the actor as, after a sign-in or a guest join. */
async function rememberChatName(actor: Actor, page: Page): Promise<void> {
  actor.chatName = (await banner(page).locator('.connect-button-name').innerText()).trim();
}

/** Opens Swarm ID's sign-in window from the viewer's My Swarm, and returns it. */
async function openSignInWindow(run: Run, actor: Actor): Promise<{ page: Page; popup: Page }> {
  const page = await viewerPage(run, actor);
  const dialog = await openConnect(page);
  const button = await waitForSwarmIdButton(run, dialog, SIGN_IN);
  const popupOpened = page.waitForEvent('popup', { timeout: 30_000 });
  await button.click();
  return { page, popup: await popupOpened };
}

/** The viewer's My Swarm says the actor is signed in with Swarm ID, and the chat takes a message. */
async function expectSignedIn(actor: Actor, page: Page): Promise<void> {
  const dialog = await openConnect(page);
  await expect(dialog.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible({ timeout: 30_000 });
  await closeConnect(page);
  await expect(chatRegion(page).getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  actor.session = 'swarm-id';
  await rememberChatName(actor, page);
}

/** How long `expect ens-link --record` watches before it writes down what it saw, since it never fails. */
const RECORD_ONLY_MS = 15_000;

/**
 * Polls what Swarm ID's frame last told the viewer of the actor's wallet until it is `wanted`, and fails saying what
 * it saw instead. With `recordOnly` it writes what it saw into the run's findings and never fails.
 */
async function expectLastUpdate(run: Run, actor: Actor, wanted: WalletLinkSeen, recordOnly: boolean): Promise<void> {
  const watched = await watchWalletLink({
    received: () => actor.received(),
    wallet: actor.wallet!.address,
    wanted,
    waitMs: recordOnly ? RECORD_ONLY_MS : ensLinkWaitMs(run.live !== null),
  });
  const after = (ms: number | null) => (ms === null ? 'never' : `after ${(ms / 1000).toFixed(1)} s`);
  const recorded = (run.findings[`${actor.name} ens link seen`] as string[] | undefined) ?? [];
  run.findings[`${actor.name} ens link seen`] = [
    ...recorded,
    `${wanted} wanted, ${watched.seen} seen, the frame's first update ${after(watched.firstUpdateMs)}, the wanted one ${after(watched.wantedMs)}`,
  ];
  if (!recordOnly && watched.seen !== wanted) {
    throw new Error(`the viewer was to see "${wanted}", and saw "${watched.seen}"`);
  }
}

/** Swarm ID's account page, its Account tab with the Identity section open, where the ENS setting is. */
async function accountPage(run: Run, actor: Actor): Promise<Page> {
  const page = await idPage(run, actor);
  await page.goto(`${run.addresses.swarmId}/`);
  await page.getByRole('tab', { name: 'Account' }).click({ timeout: CHAT_TIMEOUT_MS });
  const identity = page.locator('#account-identity');
  if ((await identity.getAttribute('aria-expanded')) !== 'true') await identity.click();
  await expect(page.getByText(ENS_SETTING)).toBeVisible({ timeout: CHAT_TIMEOUT_MS });
  return page;
}

const ensSetting = (page: Page) =>
  page
    .locator('div')
    .filter({ hasText: ENS_SETTING })
    .filter({ has: page.getByRole('button') })
    .last();

export const ACCOUNT_CHECKS: Record<string, Verb> = {
  /**
   * `expect ens-link <actor> on|off [--record]`: what Swarm ID's frame last told the viewer about the actor's identity
   * carries the actor's wallet, or does not. With `--record` it writes down what it saw and never fails, for a scenario
   * whose evidence is elsewhere.
   */
  async 'ens-link'(run, step) {
    const actor = run.actor(step.args[1]);
    if (!actor.wallet) throw new Error(`${actor.name} has no wallet`);
    const wanted = step.args[2] === 'on' ? 'update carried wallet' : 'update carried no wallet';
    await expectLastUpdate(run, actor, wanted, step.options.record === 'true');
  },
};

export const ACCOUNT_VERBS: Record<string, Verb> = {
  /**
   * `create-account password|passkey|wallet [--ens-name]`. A password or wallet account is made on Swarm ID's own
   * site. A wallet account signs with a wallet made for the run, funded on the local chain, or with `--ens-name` the
   * wallet the ENS snapshot named for this actor, which live is the target's ENS wallet and is never funded. Live, a
   * password account for an actor the scenario gives a drive is their standing account, signed in to from its phrase
   * instead of made. A passkey account is made in Swarm ID's sign-in window opened from
   * the viewer, since a virtual authenticator's passkey lives in the tab that made it, so the actor ends signed in.
   */
  async 'create-account'(run, step) {
    const actor = run.actor(step.actor!);
    const method = step.args[0];
    if (method === 'passkey') {
      const { page, popup } = await openSignInWindow(run, actor);
      await installVirtualAuthenticator(actor.context, popup);
      const create = popup.getByRole('link', { name: 'Create a new account' });
      await expect(create).toBeVisible({ timeout: 60_000 });
      await toAccessStep(popup, actor);
      await confirmAccessWithPasskey(popup);
      await popup
        .getByRole('button', { name: 'Go to app' })
        .click({ timeout: 60_000 })
        .catch(() => undefined);
      await expect.poll(() => popup.isClosed(), { timeout: 30_000 }).toBe(true);
      await expectSignedIn(actor, page);
      return;
    }
    const page = await idPage(run, actor);
    await page.goto(`${run.addresses.swarmId}/?signin`);
    const standing = run.standing.get(actor.name);
    if (method === 'password' && standing) {
      await signInToStanding(run, actor, page, standing);
      return;
    }
    if (method === 'password') {
      await completeCreateFlow(page, actor.password, actor);
      run.secrets.set(`${actor.name} password`, actor.password);
    } else if (method === 'wallet') {
      actor.wallet = walletFor(run, actor, step.options['ens-name'] === 'true');
      // Live, the wallet only signs, so it is never funded: nothing of a real chain is the kit's to pay with.
      if (!run.live) await fund(run, actor.wallet.address);
      run.secrets.set(`${actor.name} wallet key`, actor.wallet.key);
      await toAccessStep(page, actor);
      await confirmAccessWithWallet(page);
      run.findings[`${actor.name} wallet`] = actor.wallet.address;
    } else {
      throw new Error('create-account takes password, passkey or wallet');
    }
    await expect(page).toHaveURL(/\/account\/new\/done$/, { timeout: 60_000 });
    await page.getByRole('button', { name: 'Stay local for now' }).click();
    await expect(page).toHaveURL(/\/$/);
    await readSecrets(run, actor, page);
  },

  /**
   * `sign-in viewer`: Swarm ID's own button in My Swarm, its window, the account unlocked and confirmed there. A
   * standing account already holds drives, and the window would give the site the default one, so it is given no drive,
   * as a new account's site has none when it signs in.
   */
  async 'sign-in'(run, step) {
    const actor = run.actor(step.actor!);
    if (step.args[0] !== 'viewer') throw new Error('sign-in knows the viewer only');
    const { page, popup } = await openSignInWindow(run, actor);
    await confirmInWindow(popup, actor.password, actor, run.standing.has(actor.name) ? NO_DRIVE : undefined);
    await expectSignedIn(actor, page);
  },

  /** `sign-out`: Sign out in My Swarm, after which the viewer offers Swarm ID's sign-in again. */
  async 'sign-out'(run, step) {
    const actor = run.actor(step.actor!);
    const page = await viewerPage(run, actor);
    const dialog = await openConnect(page);
    await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(swarmIdButton(dialog, SIGN_IN)).toBeVisible({ timeout: CHAT_TIMEOUT_MS });
    await closeConnect(page);
    await expect(banner(page).getByRole('button', { name: 'My Swarm', exact: true })).toBeVisible();
    actor.session = null;
    actor.chatName = null;
  },

  /**
   * `link-wallet`: turns on "Show my ENS name on sites" on Swarm ID's account page, where the account's wallet unlocks
   * the account and signs the wallet link, which the account countersigns. Needs a wallet account.
   */
  async 'link-wallet'(run, step) {
    const actor = run.actor(step.actor!);
    if (!actor.wallet) throw new Error('link-wallet needs an account secured with a wallet');
    const page = await accountPage(run, actor);
    const setting = ensSetting(page);
    if (await page.getByText('On. Sites you connect to', { exact: false }).isVisible()) return;
    await setting.getByRole('button', { name: 'Turn on' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm with wallet' }).click();
    await pickInjectedWallet(page);
    const refused = page.getByRole('dialog').locator('.text-destructive');
    await expect(page.getByText('On. Sites you connect to', { exact: false }).or(refused)).toBeVisible({
      timeout: 60_000,
    });
    if (await refused.isVisible()) throw new Error(`Swarm ID refused the link: ${await refused.innerText()}`);
  },

  /**
   * `ens on|off`: on links the wallet as `link-wallet` does, off turns the setting off. Whether the viewer has heard is
   * for `expect ens-link` to say.
   */
  async ens(run, step) {
    const actor = run.actor(step.actor!);
    if (!actor.wallet) throw new Error('ens needs an account secured with a wallet');
    if (step.args[0] === 'on') {
      await ACCOUNT_VERBS['link-wallet'](run, step);
      return;
    }
    if (step.args[0] !== 'off') throw new Error('ens takes on or off');
    const page = await accountPage(run, actor);
    const setting = ensSetting(page);
    await setting.getByRole('button', { name: 'Turn off' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Turn off' }).click();
    await expect(page.getByText('Off. Sites see only', { exact: false })).toBeVisible({ timeout: 30_000 });
  },

  /**
   * `change-stamp`: Change stamp in Swarm ID in My Swarm's My stamp box, and the newest drive of the run picked in its
   * window. Swarm ID's frame must then name that drive to the viewer.
   */
  async 'change-stamp'(run, step) {
    const actor = run.actor(step.actor!);
    const drive = drivesOf(run, actor).at(-1);
    if (!drive) throw new Error('change-stamp needs a drive bought in the run');
    const page = await viewerPage(run, actor);
    const group = chatStampGroup(await openConnect(page));
    const change = await waitForSwarmIdButton(run, group, CHANGE_STAMP);
    const popupOpened = page.waitForEvent('popup', { timeout: 30_000 });
    await change.click();
    await confirmInWindow(await popupOpened, actor.password, actor, drive);
    await expect
      .poll(async () => stampsNamedToViewer(await actor.received()).at(-1), {
        message: 'Swarm ID names the new drive to the viewer',
        timeout: CHAT_TIMEOUT_MS,
      })
      .toBe(drive);
    run.findings[`${actor.name} site drive`] = drive;
    await closeConnect(page);
  },
};
