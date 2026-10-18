import { CHAT_TIMEOUT_MS } from './run.ts';
import { walletLinkSeen, type WalletLinkSeen } from './stampEvidence.ts';

/**
 * How long `expect ens-link` waits live. After a reload the deployment's Swarm ID frame can take most of a minute to
 * start, its files still being asked again after bzz.link's 500s (56 s measured on swarm-dev, 2026-10-18).
 */
export const ENS_LINK_LIVE_WAIT_MS = 120_000;
const POLL_MS = 1_000;

export const ensLinkWaitMs = (live: boolean): number => (live ? ENS_LINK_LIVE_WAIT_MS : CHAT_TIMEOUT_MS);

/** What a watch of the frame's updates saw, and how long after its start the first and the wanted update came. */
export interface WalletLinkWatch {
  seen: WalletLinkSeen;
  firstUpdateMs: number | null;
  wantedMs: number | null;
}

export interface WatchOptions {
  received: () => Promise<string>;
  wallet: string;
  wanted: WalletLinkSeen;
  waitMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Polls what Swarm ID's frame told the viewer until it carries `wanted` or the wait runs out. */
export async function watchWalletLink(options: WatchOptions): Promise<WalletLinkWatch> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = now();
  let seen: WalletLinkSeen = 'no update';
  let firstUpdateMs: number | null = null;
  while (now() - started <= options.waitMs) {
    seen = walletLinkSeen(await options.received(), options.wallet);
    if (seen !== 'no update' && firstUpdateMs === null) firstUpdateMs = now() - started;
    if (seen === options.wanted) return { seen, firstUpdateMs, wantedMs: now() - started };
    await sleep(POLL_MS);
  }
  return { seen, firstUpdateMs, wantedMs: null };
}
