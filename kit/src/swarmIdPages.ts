/**
 * Swarm ID's own pages, driven the way the Solar Punk fork's browser suites drive them (`ui/tests/helpers.ts` and
 * `ui/tests/drive-onchain-setup.ts` at the pinned commit). The labels are Swarm ID's, so a change there shows up here
 * as a step that cannot find its control, with the screenshot of what was on the page instead.
 */
import { expect, type Locator, type Page } from '@playwright/test';

import { pickInjectedWallet } from './wallet.ts';

/** The dev server compiles a route on its first request, which on a busy machine takes well past a click's budget. */
const FIRST_LOAD_MS = 60_000;
/** Buying a drive is several five-second blocks of funding, approving and creating the batch. */
const DRIVE_MS = 150_000;
/** The depth `/dev`'s Create drive to test with buys, which is the only one it offers. */
export const DEV_DRIVE_DEPTH = 20;

/** How an actor keeps secrets out of its trace: a step that types, shows or returns one runs with the trace paused. */
interface Untraced {
  untraced<T>(step: () => Promise<T>): Promise<T>;
}

/** The account-creation wizard, with the password access method, ending where the entry point sends it. */
export async function completeCreateFlow(page: Page, password: string, secrets: Untraced): Promise<void> {
  await toAccessStep(page, secrets);
  await page.getByRole('tab', { name: 'Password' }).click();
  // A snapshot of any later action would hold the typed fields' values, so the trace stays paused until the page has
  // left them.
  await secrets.untraced(async () => {
    await page.locator('#new-password').fill(password);
    await page.locator('#verify-password').fill(password);
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page).toHaveURL(/\/account\/new\/done$/, { timeout: FIRST_LOAD_MS });
  });
}

/**
 * The wizard up to its access step. The recovery phrase is on screen from Reveal until the next step, so that stretch
 * runs with the trace paused, or every snapshot of it would hold the phrase.
 */
export async function toAccessStep(page: Page, secrets: Untraced): Promise<void> {
  await page.getByRole('link', { name: 'Create a new account' }).click({ timeout: FIRST_LOAD_MS });
  await expect(page).toHaveURL(/\/account\/new$/);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/account\/new\/phrase$/);
  await secrets.untraced(async () => {
    await page.getByRole('button', { name: 'Reveal' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/account\/new\/access$/);
  });
}

/**
 * Finding the account on Swarm from its phrase reads its published state through Swarm ID's own gateway, and on a new
 * device that is several feed lookups.
 */
const FOLD_MS = 180_000;

/**
 * Signs in to an existing account in this browser from its recovery phrase, Swarm ID's "I already have an account",
 * and secures it here with `password`, ending on Swarm ID's home page. Swarm ID reads the account's published state
 * from Swarm and keeps its drives, connected sites and settings as they are. The phrase and the password are typed
 * with the trace paused, until the page has left their fields. A phrase Swarm ID finds no account for fails the step,
 * and its offer to set up a new account under the phrase is never taken.
 */
export async function signInWithPhrase(page: Page, phrase: string, password: string, secrets: Untraced): Promise<void> {
  await page.getByRole('link', { name: 'I already have an account' }).click({ timeout: FIRST_LOAD_MS });
  await expect(page).toHaveURL(/\/account\/import$/);
  const main = page.getByRole('main');
  const refused = main.getByText(/^(Sign in failed|No account found)$/);
  await secrets.untraced(async () => {
    await main.getByRole('textbox').fill(phrase);
    await main.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Access security' }).or(refused)).toBeVisible({ timeout: FOLD_MS });
  });
  if (await refused.isVisible()) {
    const words = await main.locator('p').allInnerTexts();
    throw new Error(`Swarm ID did not sign in from the phrase: ${words.join(' ').replace(/\s+/g, ' ')}`);
  }
  await expect(page).toHaveURL(/\/account\/new\/access$/);
  await page.getByRole('tab', { name: 'Password' }).click();
  await secrets.untraced(async () => {
    await page.locator('#new-password').fill(password);
    await page.locator('#verify-password').fill(password);
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page).toHaveURL(/\/account\/ready$/, { timeout: FIRST_LOAD_MS });
  });
  await page.getByRole('link', { name: 'Continue with this account' }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** The account Swarm ID keeps in its own storage, as the identity site's first-party page reads it. */
interface StoredAccounts {
  data?: {
    id?: string;
    derivationKey?: string;
    postageStamps?: { batchID: string; depth: number; signerKey: string }[];
    devices?: { deviceId: string; removedAt?: number }[];
  }[];
}

export function storedAccount(idPage: Page) {
  return idPage.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem('swarm-id-accounts') ?? '{}') as StoredAccounts;
    return doc.data?.[0] ?? null;
  });
}

/** The id Swarm ID gave this browser as one of the account's devices, which names its device-state feed. */
export async function thisDeviceId(idPage: Page): Promise<string[]> {
  const id = await idPage.evaluate(() => localStorage.getItem('swarm-id-device-id'));
  return id ? [id] : [];
}

/**
 * Opens a value Swarm ID sealed at rest: AES-GCM under the identity page's own wrapping key in IndexedDB, written as
 * `sealed:v1:` then the hex of the IV and the ciphertext. The fork's `openSealedInPage`, which only a page of the
 * identity origin can run.
 */
export function openSealed(idPage: Page, sealed: string): Promise<string> {
  return idPage.evaluate(async (value) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('swarm-id-keys', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const key = await new Promise<CryptoKey>((resolve, reject) => {
      const read = db.transaction('wrapping-keys').objectStore('wrapping-keys').get('at-rest-v1');
      read.onsuccess = () => resolve(read.result as CryptoKey);
      read.onerror = () => reject(read.error);
    });
    db.close();
    const bytes = Uint8Array.from((value.slice('sealed:v1:'.length).match(/../g) ?? []).map((b) => parseInt(b, 16)));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
    return new TextDecoder().decode(plain);
  }, sealed);
}

/**
 * `/dev` → Chain → Create drive to test with, which buys a real depth-20 batch on the local chain owned by the
 * account's own postage signer and attaches it as a drive. Returns the batch id the page names. The Chain tab shows a
 * private key on screen, so the caller runs this with the trace paused and leaves the page before anything else is
 * captured of it.
 */
export async function createDevDrive(idPage: Page, swarmIdOrigin: string): Promise<string> {
  await idPage.goto(`${swarmIdOrigin}/dev`);
  await idPage.getByRole('tab', { name: 'Chain' }).click({ timeout: FIRST_LOAD_MS });
  await idPage.getByRole('button', { name: 'Create drive to test with' }).click();
  const created = idPage.getByText(/^Created drive: 0x[0-9a-f]{64}$/);
  await expect(created).toBeVisible({ timeout: DRIVE_MS });
  const batchID = (await created.innerText()).replace('Created drive: 0x', '');
  await expect
    .poll(async () => (await storedAccount(idPage))?.postageStamps?.find((s) => s.batchID === batchID)?.depth, {
      timeout: DRIVE_MS,
    })
    .toBe(DEV_DRIVE_DEPTH);
  return batchID;
}

/** The connect window's drive picker entry that gives the site no drive. */
export const NO_DRIVE = 'No drive';

/**
 * Sets every site on the account's Apps screen to "No drive" and returns how many had one. A site is not removed,
 * because a removal is published to the account and ends that site's session in every browser that restores it.
 */
export async function giveEverySiteNoDrive(idPage: Page, swarmIdOrigin: string): Promise<number> {
  await idPage.goto(`${swarmIdOrigin}/`);
  await idPage.getByRole('tab', { name: 'Apps' }).click({ timeout: FIRST_LOAD_MS });
  const pickers = idPage.getByLabel('Drive this app uses');
  let changed = 0;
  const chosen = (picker: Locator) =>
    picker.evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.text ?? '');
  for (let index = 0; index < (await pickers.count()); index++) {
    const picker = pickers.nth(index);
    if ((await chosen(picker)) === NO_DRIVE) continue;
    await picker.selectOption({ label: NO_DRIVE });
    await expect.poll(() => chosen(picker)).toBe(NO_DRIVE);
    changed++;
  }
  return changed;
}

/**
 * "Go to app" closes the popup from its click handler, so under load the window can be gone before the click returns.
 * The closure is what is checked.
 */
async function goToApp(popup: Page): Promise<void> {
  await popup
    .getByRole('button', { name: 'Go to app' })
    .click()
    .catch(() => undefined);
  await expect.poll(() => popup.isClosed(), { timeout: 30_000 }).toBe(true);
}

/**
 * In the Swarm ID window: picks the account, unlocks it the way it is secured, picks the drive when one is offered,
 * and confirms. A password is typed with the trace paused, a wallet is picked in Swarm ID's wallet picker and signs in
 * the kit's process, and a passkey answers from the window's own virtual authenticator. A site the account is still
 * connected to needs no unlock at all.
 */
export async function confirmInWindow(popup: Page, password: string, secrets: Untraced, drive?: string): Promise<void> {
  await popup.getByRole('button', { name: /0x[0-9a-fA-F]{4}/ }).click({ timeout: FIRST_LOAD_MS });
  const typed = popup.getByRole('textbox', { name: 'Account password' });
  const byWallet = popup.getByRole('button', { name: 'Confirm with wallet' });
  const byPasskey = popup.getByRole('button', { name: 'Confirm with passkey' });
  const asked = await typed
    .or(byWallet)
    .or(byPasskey)
    .first()
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (asked && (await typed.isVisible())) {
    await secrets.untraced(async () => {
      await typed.fill(password);
      await popup.getByRole('button', { name: 'Confirm' }).click();
      await expect(typed).toBeHidden({ timeout: 30_000 });
    });
  } else if (asked && (await byWallet.isVisible())) {
    await byWallet.click();
    await pickInjectedWallet(popup);
    await expect(byWallet).toBeHidden({ timeout: 30_000 });
  } else if (asked) {
    await byPasskey.click();
    await expect(byPasskey).toBeHidden({ timeout: 30_000 });
  }
  if (drive) {
    const picker = popup.getByRole('combobox', { name: 'Select drive' });
    await expect(picker).toBeVisible({ timeout: 30_000 });
    await picker.selectOption(drive);
  }
  await goToApp(popup);
}

/**
 * The wizard's access step finished with a wallet: Swarm ID's wallet picker, then the wallet signs in the kit's
 * process. Ends on the page the wizard moves to.
 */
export async function confirmAccessWithWallet(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'ETH wallet' }).click();
  await page.getByRole('button', { name: 'Confirm with wallet' }).click();
  await pickInjectedWallet(page);
}

/** The wizard's access step finished with a passkey, which the page's virtual authenticator answers by itself. */
export async function confirmAccessWithPasskey(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Passkey' }).click();
  await page.getByRole('button', { name: 'Confirm with passkey' }).click();
}
