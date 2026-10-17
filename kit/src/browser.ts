import { type Browser, chromium } from '@playwright/test';

import type { BrowserProfile } from './scenario.ts';

/**
 * Every name but the local ones resolves to nothing, so a request that gets past the kit's request routing, from a
 * service worker or a part Playwright does not route, still reaches no host off this machine. The IPv6 loopback
 * literal goes through these rules too and is excluded only by its bare spelling, `::1`: written `[::1]` it resolves to
 * nothing.
 */
const LOCAL_NAMES_ONLY =
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE *.localhost, EXCLUDE 127.0.0.1, EXCLUDE ::1';

/**
 * Chromium's switches on every machine the kit runs on. `--no-sandbox` because a CI job may run as root
 * in a container, where Chrome will not start with its sandbox.
 */
export const BASE_ARGS = [
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-gpu',
  LOCAL_NAMES_ONLY,
];

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
 * opens is refused.
 */
export async function launchForProfile(profile: BrowserProfile): Promise<{ browser: Browser; args: string[] }> {
  if (profile === 'plain') throw new Error('the kit needs storage partitioning, so there is no plain browser');
  const args = [
    ...BASE_ARGS,
    ...(await partitioningArgs()),
    ...(profile === 'popup-blocked' ? POPUP_BLOCKED_ARGS : []),
  ];
  const launchOptions =
    profile === 'popup-blocked' ? { args, ignoreDefaultArgs: ['--disable-popup-blocking'] } : { args };
  return { browser: await chromium.launch(launchOptions), args };
}
