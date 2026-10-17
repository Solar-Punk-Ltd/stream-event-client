import { type Browser, chromium } from '@playwright/test';

import { type Guard, LOCAL_GUARD, resolverRules } from './guard.ts';
import type { BrowserProfile } from './scenario.ts';

/**
 * Chromium's switches on every machine the kit runs on. `--no-sandbox` because a CI job may run as root
 * in a container, where Chrome will not start with its sandbox.
 */
const MACHINE_ARGS = ['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'];

/** The local stack's switches, under which every name but the local ones resolves to nothing. */
export const BASE_ARGS = [...MACHINE_ARGS, resolverRules(LOCAL_GUARD.hosts)];

const PARTITIONING = 'ThirdPartyStoragePartitioning';

/**
 * The switches that turn third-party storage partitioning back on. Playwright's own defaults disable it, so a browser
 * started plainly keeps a frame of another site in that site's own storage, which no real Chrome does. Chromium keeps
 * the last `--disable-features` it is given, so the list is Playwright's own, read back from a running browser, less
 * that one feature. Read at every launch rather than copied, so a Playwright upgrade cannot leave a stale list behind.
 */
async function partitioningArgs(): Promise<string[]> {
  // Chromium answers getBrowserCommandLine only to a browser started for automation, which Playwright's does not say.
  const probe = await chromium.launch({ args: [...BASE_ARGS, '--enable-automation'] });
  try {
    const session = await probe.newBrowserCDPSession();
    const { arguments: line } = (await session.send('Browser.getBrowserCommandLine')) as { arguments: string[] };
    const disabled = line.find((arg) => arg.startsWith('--disable-features='));
    const kept = (disabled?.slice('--disable-features='.length).split(',') ?? []).filter(
      (feature) => feature !== PARTITIONING,
    );
    return [`--disable-features=${kept.join(',')}`, `--enable-features=${PARTITIONING}`];
  } finally {
    await probe.close();
  }
}

/** A browser that partitions storage as Chrome does, and the switches it was started with, for the run header. */
export async function launchPartitioned(): Promise<{ browser: Browser; args: string[] }> {
  const args = [...BASE_ARGS, ...(await partitioningArgs())];
  return { browser: await chromium.launch({ args }), args };
}

/**
 * Blocks a window opened without a direct click, which a gesture-less popup is, so Swarm ID's button under it opens a
 * window the browser refuses. With this, a click-opened window is refused while the kit's own `newPage` still works,
 * so the kit drives the stack and the hostile popup alike.
 */
const POPUP_BLOCKED_ARGS = ['--block-new-web-contents'];

/**
 * The browser for a scenario's profile. `partitioned` is the one every scenario but the popup one uses. `popup-blocked`
 * adds a real popup blocker, and removes Playwright's own switch that turns one off, so the window Swarm ID's button
 * opens is refused. The guard names the outside hosts the browser may resolve, none for the local stack.
 */
export async function launchForProfile(
  profile: BrowserProfile,
  guard: Guard = LOCAL_GUARD,
): Promise<{ browser: Browser; args: string[] }> {
  if (profile === 'plain') throw new Error('the kit needs storage partitioning, so there is no plain browser');
  const args = [
    ...MACHINE_ARGS,
    resolverRules(guard.hosts),
    ...(await partitioningArgs()),
    ...(profile === 'popup-blocked' ? POPUP_BLOCKED_ARGS : []),
  ];
  const launchOptions =
    profile === 'popup-blocked' ? { args, ignoreDefaultArgs: ['--disable-popup-blocking'] } : { args };
  return { browser: await chromium.launch(launchOptions), args };
}
