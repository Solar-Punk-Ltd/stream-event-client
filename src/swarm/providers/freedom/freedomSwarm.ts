/**
 * Freedom's `window.swarm`: the object Freedom puts in the top frame of every page it opens, outside a private
 * window, through which a page reads Swarm from the viewer's own node. Its methods, errors and read budget are those
 * of Freedom's provider API (solardev-xyz/freedom-browser, docs/swarm-provider-api.md).
 */

/** What this app asks of `window.swarm`: the one call every method goes through. */
export interface FreedomSwarm {
  readonly isFreedomBrowser?: boolean;
  request(args: { readonly method: string; readonly params?: Readonly<Record<string, unknown>> }): Promise<unknown>;
}

/** What a call rejects with: a code, and for most failures a reason in `data`. */
interface FreedomError {
  readonly code?: number;
  readonly message?: string;
  readonly data?: { readonly reason?: string; readonly windowMs?: number };
}

/** The user declined a prompt. */
const USER_REJECTED = 4001;
/** The node is not running, or Freedom's Identity & Wallet setting is off and every call fails. */
export const NODE_UNAVAILABLE = 4900;
/** The request was malformed, or one of the answers a read names in `data.reason`, the read budget among them. */
export const INVALID_PARAMS = -32602;

/** Freedom's own window for its read budget, and what a refusal over budget names as `data.windowMs`. */
export const FREEDOM_BUDGET_WINDOW_MS = 60_000;

/** The page's `window.swarm` when the page runs in Freedom, else null. */
export function pageFreedomSwarm(): FreedomSwarm | null {
  const swarm = typeof window === 'undefined' ? undefined : (window as { swarm?: FreedomSwarm }).swarm;
  return swarm?.isFreedomBrowser === true && typeof swarm.request === 'function' ? swarm : null;
}

/** Whether the page runs in Freedom, which is the only browser the source of that name is offered in. */
export function isFreedomBrowser(): boolean {
  return pageFreedomSwarm() !== null;
}

export function freedomErrorOf(error: unknown): FreedomError {
  return typeof error === 'object' && error !== null ? (error as FreedomError) : {};
}

/** Whether Freedom counts this site as connected, which raises its read budget. */
export type SiteConnection = 'connected' | 'not-connected' | 'unknown';

/** What asking Freedom to connect this site ended as. */
export type ConnectOutcome = 'connected' | 'declined' | 'failed';

/**
 * Whether the viewer declined the connect prompt on this page, which then does not ask again until it is loaded again.
 * Freedom may answer a second request of the same page with the refusal and no prompt, so a button that asked again
 * would seem to do nothing.
 */
let declinedOnThisPage = false;

export function connectDeclined(): boolean {
  return declinedOnThisPage;
}

/** Asks Freedom, with no prompt, whether this site is connected. `swarm_getCapabilities` says so in its reason. */
export async function siteConnection(swarm: FreedomSwarm | null = pageFreedomSwarm()): Promise<SiteConnection> {
  if (swarm === null) {
    return 'unknown';
  }
  try {
    const capabilities: unknown = await swarm.request({ method: 'swarm_getCapabilities' });
    // Freedom always names a reason, null where nothing holds the site back, so an answer without one says nothing.
    const reason =
      typeof capabilities === 'object' && capabilities !== null
        ? (capabilities as { reason?: unknown }).reason
        : undefined;
    if (reason === 'not-connected') {
      return 'not-connected';
    }
    return reason === null || typeof reason === 'string' ? 'connected' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Connects this site, which shows Freedom's connect prompt once, so its read budget rises from 120 to 600 reads a
 * minute. Only ever called on the viewer's click: the page never prompts on its own.
 */
export async function connectSite(swarm: FreedomSwarm | null = pageFreedomSwarm()): Promise<ConnectOutcome> {
  if (swarm === null || declinedOnThisPage) {
    return declinedOnThisPage ? 'declined' : 'failed';
  }
  try {
    await swarm.request({ method: 'swarm_requestAccess' });
    return 'connected';
  } catch (error) {
    if (freedomErrorOf(error).code === USER_REJECTED) {
      declinedOnThisPage = true;
      return 'declined';
    }
    return 'failed';
  }
}
