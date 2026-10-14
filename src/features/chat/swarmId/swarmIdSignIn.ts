import type { VerifyScope } from '../verify/verdicts';

import {
  isWindowBlocked,
  type LoadSwarmIdClient,
  type SwarmIdClient,
  type SwarmIdConnectionInfo,
} from './swarmIdClient';
import { type SwarmIdSession, swarmIdSession } from './swarmIdSession';

export const SWARM_ID_STARTING = 'starting';
export const SWARM_ID_SIGNED_OUT = 'signed-out';
export const SWARM_ID_BLOCKED = 'blocked';
export const SWARM_ID_SIGNED_IN = 'signed-in';
export const SWARM_ID_UNAVAILABLE = 'unavailable';

export type SwarmIdState =
  /** The library is loading and its frame restoring the session it keeps, if any. */
  | { readonly status: typeof SWARM_ID_STARTING }
  /** Ready to sign in. `problem` says why the last try did not get there, when it did not. */
  | { readonly status: typeof SWARM_ID_SIGNED_OUT; readonly problem: string | null }
  /** The browser blocked the Swarm ID window, which only a click can open now. */
  | { readonly status: typeof SWARM_ID_BLOCKED }
  | { readonly status: typeof SWARM_ID_SIGNED_IN; readonly session: SwarmIdSession }
  /** The library could not start, as for a site the Swarm ID site does not serve, so there is no sign-in. */
  | { readonly status: typeof SWARM_ID_UNAVAILABLE };

export const WINDOW_FAILED = 'The Swarm ID window did not open. Try again.';
export const SIGN_IN_INCOMPLETE = 'Swarm ID signed you in without confirming a chat address for this site.';
export const NO_CHAT_KEY = 'Swarm ID did not give this site its chat key. Try again.';
const SIGN_OUT_FAILED = 'Swarm ID did not end the session, so it may sign you in again on your next visit.';

/**
 * The image's policy and the page's config name the Swarm ID site apart, and a page whose two differ has its frame
 * refused, which the library reports only as a start that timed out. So the console says what to compare.
 */
export function frameRefusedWarning(url: string): string {
  return (
    `Swarm ID at ${url} could not start or its frame was refused. The image's SWARM_ID_URL and config.json's ` +
    'swarmId.url must be the identical origin, and the Swarm ID site must serve this one.'
  );
}

const FRAME_DIRECTIVE = 'frame-src';
const POLICY_VIOLATION = 'securitypolicyviolation';

interface SwarmIdSignInOptions {
  url: string;
  appName: string;
  /** This page's origin, which every binding must name. */
  scope: VerifyScope;
  load: LoadSwarmIdClient;
  warn?: (message: string) => void;
}

/**
 * Who the viewer is with Swarm ID, kept in memory only. The chat key the ID gives this site is held in the session
 * here and nowhere else. A reload asks the library again, whose frame keeps its own session for this site.
 */
export interface SwarmIdSignIn {
  getState(): SwarmIdState;
  subscribe(listener: () => void): () => void;
  start(): void;
  /** Opens the Swarm ID window. Call it from a click and from nothing else, or the browser blocks the window. */
  signIn(): void;
  signOut(): Promise<void>;
  stop(): void;
}

const SIGNED_OUT: SwarmIdState = { status: SWARM_ID_SIGNED_OUT, problem: null };

export function createSwarmIdSignIn({
  url,
  appName,
  scope,
  load,
  warn = (message) => console.warn(message),
}: SwarmIdSignInOptions): SwarmIdSignIn {
  let state: SwarmIdState = { status: SWARM_ID_STARTING };
  const listeners = new Set<() => void>();
  let client: SwarmIdClient | null = null;
  let isStarted = false;
  let isReady = false;
  let isStopped = false;
  /** The newest report before the library was ready, applied once it is. */
  let reportedEarly: SwarmIdConnectionInfo | null = null;
  /** Raised by every report and every sign-out, so a chat key asked for an older session is dropped. */
  let generation = 0;

  let hasWarned = false;
  const warnOnce = () => {
    if (!hasWarned) {
      hasWarned = true;
      warn(frameRefusedWarning(url));
    }
  };
  const onPolicyViolation = (event: Event) => {
    const { effectiveDirective, blockedURI } = event as SecurityPolicyViolationEvent;
    if (effectiveDirective === FRAME_DIRECTIVE && (blockedURI === url || blockedURI.startsWith(`${url}/`))) {
      warnOnce();
    }
  };
  const hasDocument = typeof document !== 'undefined';

  const set = (next: SwarmIdState) => {
    if (isStopped) {
      return;
    }
    state = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const apply = (info: SwarmIdConnectionInfo) => {
    generation += 1;
    const asked = generation;
    const { identity, chatBinding } = info;
    if (!identity) {
      if (state.status !== SWARM_ID_BLOCKED) {
        set(SIGNED_OUT);
      }
      return;
    }
    if (!chatBinding) {
      set({ status: SWARM_ID_SIGNED_OUT, problem: SIGN_IN_INCOMPLETE });
      return;
    }
    client!.getChatKey().then(
      (chatKey) => {
        if (asked !== generation) {
          return;
        }
        // A key the signer cannot take throws. Its error is never shown, so nothing of the key reaches a message.
        let result: ReturnType<typeof swarmIdSession>;
        try {
          result = swarmIdSession(identity, chatBinding, chatKey, scope);
        } catch {
          set({ status: SWARM_ID_SIGNED_OUT, problem: NO_CHAT_KEY });
          return;
        }
        set(
          result.ok
            ? { status: SWARM_ID_SIGNED_IN, session: result.session }
            : { status: SWARM_ID_SIGNED_OUT, problem: result.problem },
        );
      },
      () => {
        if (asked === generation) {
          set({ status: SWARM_ID_SIGNED_OUT, problem: NO_CHAT_KEY });
        }
      },
    );
  };

  const onConnectionChange = (info: SwarmIdConnectionInfo) => {
    if (isReady) {
      apply(info);
    } else {
      reportedEarly = info;
    }
  };

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    start() {
      if (isStarted) {
        return;
      }
      isStarted = true;
      if (hasDocument) {
        document.addEventListener(POLICY_VIOLATION, onPolicyViolation);
      }
      load({ url, appName, onConnectionChange })
        .then((loaded) => {
          client = loaded;
          if (isStopped) {
            loaded.destroy();
            return;
          }
          return loaded.initialize().then(() => {
            isReady = true;
            apply(reportedEarly ?? loaded.connectionInfo);
            reportedEarly = null;
          });
        })
        .catch(() => {
          warnOnce();
          set({ status: SWARM_ID_UNAVAILABLE });
        });
    },

    signIn() {
      if (!client || !isReady || state.status === SWARM_ID_SIGNED_IN) {
        return;
      }
      client.connect().then(
        () => {
          if (state.status === SWARM_ID_BLOCKED) {
            set(SIGNED_OUT);
          }
        },
        (error: unknown) =>
          set(
            isWindowBlocked(error)
              ? { status: SWARM_ID_BLOCKED }
              : { status: SWARM_ID_SIGNED_OUT, problem: WINDOW_FAILED },
          ),
      );
    },

    async signOut() {
      generation += 1;
      set(SIGNED_OUT);
      try {
        await client?.disconnect();
      } catch {
        set({ status: SWARM_ID_SIGNED_OUT, problem: SIGN_OUT_FAILED });
      }
    },

    stop() {
      isStopped = true;
      listeners.clear();
      if (hasDocument) {
        document.removeEventListener(POLICY_VIOLATION, onPolicyViolation);
      }
      client?.destroy();
    },
  };
}
