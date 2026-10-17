import { randomBytes } from 'node:crypto';

import { PrivateKey } from '@ethersphere/bee-js';
import { type Browser, chromium } from '@playwright/test';
import { createChatMessage, MessageType, MessageVia, verifyChatMessage } from '@solarpunkltd/swarm-chat-js';

import { signChatBinding } from '../../e2e/record/chatBinding.ts';
import { Addressing, addressesFor } from './addresses.ts';
import { BASE_ARGS, launchPartitioned } from './browser.ts';

const PROBE_KEY = '__flow-kit-partition-probe';

/** Whether a frame of `frameOrigin` inside a page of `pageOrigin` writes to storage apart from `frameOrigin`'s own. */
async function framePartitioned(browser: Browser, pageOrigin: string, frameOrigin: string): Promise<boolean> {
  const context = await browser.newContext();
  try {
    // Both origins are answered by the browser itself, so the probe needs no server and no name resolution. Whether
    // two origins are one site is the browser's own reading of their names, which a request never reaches.
    await context.route(`${pageOrigin}/**`, (route) =>
      route.fulfill({ contentType: 'text/html', body: `<iframe src="${frameOrigin}/frame"></iframe>` }),
    );
    await context.route(`${frameOrigin}/**`, (route) => route.fulfill({ contentType: 'text/html', body: '<p></p>' }));
    const page = await context.newPage();
    await page.goto(`${pageOrigin}/`);
    const deadline = Date.now() + 10_000;
    let frame = page.frames().find((candidate) => candidate.url().startsWith(frameOrigin));
    while (!frame && Date.now() < deadline) {
      await page.waitForTimeout(100);
      frame = page.frames().find((candidate) => candidate.url().startsWith(frameOrigin));
    }
    if (!frame) throw new Error(`the page at ${pageOrigin} never held a frame of ${frameOrigin}`);
    await frame.evaluate((key) => localStorage.setItem(key, 'written in the frame'), PROBE_KEY);
    const firstParty = await context.newPage();
    await firstParty.goto(`${frameOrigin}/`);
    return (await firstParty.evaluate((key) => localStorage.getItem(key), PROBE_KEY)) === null;
  } finally {
    await context.close();
  }
}

/**
 * Whether the chat accepts a Swarm ID binding naming `site`. The viewer, the chat server and Swarm ID read a binding
 * with the same rule, which takes plain http only for `localhost`, `127.0.0.1` and `[::1]`, so a viewer elsewhere could
 * never show a Swarm ID sign-in however its frames are kept.
 */
function bindingAccepted(site: string): { accepted: boolean; reason: string } {
  const author = new PrivateKey(randomBytes(32));
  const ts = Date.now();
  try {
    const message = createChatMessage(author, {
      topic: 'flow-kit-probe',
      type: MessageType.TEXT,
      text: 'probe',
      name: 'probe',
      ts,
      via: MessageVia.GATEWAY,
      idb: signChatBinding(randomBytes(32), site, author.publicKey().address().toHex(), new Date(ts)),
    }).message;
    const verdict = verifyChatMessage(message, { origin: site, allowLocalHttp: true });
    if (!verdict.ok) return { accepted: false, reason: `${verdict.reason}: ${verdict.detail}` };
    return verdict.identity ? { accepted: true, reason: 'accepted' } : { accepted: false, reason: 'no identity' };
  } catch (error) {
    return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

interface SchemeReading {
  viewer: string;
  swarmId: string;
  partitioned: boolean;
  bindingAccepted: boolean;
  bindingReason: string;
}

/** What `kit probe` measured, and the scheme the stack is served on because of it. */
export interface ProbeResult {
  measuredAt: string;
  schemes: Record<Addressing, SchemeReading>;
  /** The names pair in a browser started as Playwright starts it, which must read shared for the probe to mean anything. */
  controlUnpartitioned: boolean;
  chosen: Addressing | null;
  reason: string;
}

/**
 * The scheme the stack is served on: the names when they give two sites a binding can name, else loopback when that
 * does, else none. A plain browser that also keeps the names apart means the measurement cannot tell partitioning from
 * anything else, so nothing is chosen then either.
 */
export function chooseScheme(
  schemes: Record<Addressing, SchemeReading>,
  controlUnpartitioned: boolean,
): Pick<ProbeResult, 'chosen' | 'reason'> {
  if (!controlUnpartitioned) {
    return {
      chosen: null,
      reason:
        'the control, a browser without partitioning, also kept the two names apart, so the probe measured nothing',
    };
  }
  const works = (mode: Addressing) => schemes[mode].partitioned && schemes[mode].bindingAccepted;
  const chosen = works(Addressing.NAMES) ? Addressing.NAMES : works(Addressing.LOOPBACK) ? Addressing.LOOPBACK : null;
  const reason =
    chosen === Addressing.NAMES
      ? 'the names under localhost are two sites and the viewer origin can carry a binding'
      : chosen === Addressing.LOOPBACK
        ? `the names scheme ${schemes.names.partitioned ? 'is two sites' : 'is one site'} and its viewer origin ${schemes.names.bindingAccepted ? 'can' : 'cannot'} carry a Swarm ID binding, so the loopback scheme serves`
        : 'neither scheme gives two sites whose viewer can carry a binding';
  return { chosen, reason };
}

/**
 * Measures both schemes in a partitioning browser, with a plain browser as the control, and picks the names scheme
 * when it gives two sites a binding can name, else the loopback scheme when that does, else nothing.
 */
export async function probe(): Promise<ProbeResult> {
  const { browser } = await launchPartitioned();
  const plain = await chromium.launch({ args: BASE_ARGS });
  try {
    const schemes = {} as Record<Addressing, SchemeReading>;
    for (const mode of Object.values(Addressing)) {
      const { viewer, swarmId } = addressesFor(mode);
      const binding = bindingAccepted(viewer);
      schemes[mode] = {
        viewer,
        swarmId,
        partitioned: await framePartitioned(browser, viewer, swarmId),
        bindingAccepted: binding.accepted,
        bindingReason: binding.reason,
      };
    }
    const names = addressesFor(Addressing.NAMES);
    const controlUnpartitioned = !(await framePartitioned(plain, names.viewer, names.swarmId));
    const { chosen, reason } = chooseScheme(schemes, controlUnpartitioned);
    return { measuredAt: new Date().toISOString(), schemes, controlUnpartitioned, chosen, reason };
  } finally {
    await browser.close();
    await plain.close();
  }
}
