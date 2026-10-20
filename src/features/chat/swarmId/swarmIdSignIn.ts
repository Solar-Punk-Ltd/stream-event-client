import type { VerifyScope } from '../verify/verdicts';

import type {
  LoadSwarmIdClient,
  SwarmIdButtonOptions,
  SwarmIdChunkToStamp,
  SwarmIdClient,
  SwarmIdConnectionInfo,
  SwarmIdMountedButton,
  SwarmIdPostageBatch,
  SwarmIdStampedChunk,
} from './swarmIdClient';
import { reportedAgain, type SwarmIdSession, swarmIdSession } from './swarmIdSession';

export const SWARM_ID_STARTING = 'starting';
export const SWARM_ID_SIGNED_OUT = 'signed-out';
export const SWARM_ID_SIGNED_IN = 'signed-in';
export const SWARM_ID_UNAVAILABLE = 'unavailable';

export type SwarmIdState =
  /** The library is loading and its frame restoring the session it keeps, if any. */
  | { readonly status: typeof SWARM_ID_STARTING }
  /** Ready to sign in. `problem` says why the last try did not get there, when it did not. */
  | { readonly status: typeof SWARM_ID_SIGNED_OUT; readonly problem: string | null }
  | { readonly status: typeof SWARM_ID_SIGNED_IN; readonly session: SwarmIdSession }
  /** The library could not start, as for a site the Swarm ID site does not serve, so there is no sign-in. */
  | { readonly status: typeof SWARM_ID_UNAVAILABLE };

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
  /**
   * The Bee API base URL of the source the viewer picked for the chat history, which this site's content in Swarm ID
   * follows, or null for a source with no such address.
   */
  beeApiUrl?: string | null;
}

/**
 * Who the viewer is with Swarm ID, kept in memory only. The chat key the ID gives this site is held in the session
 * here and never written to storage. A reload asks the library again, whose frame keeps its own session for this site.
 */
export interface SwarmIdSignIn {
  getState(): SwarmIdState;
  subscribe(listener: () => void): () => void;
  start(): void;
  /**
   * Shows Swarm ID's button in the container, whose click opens the Swarm ID window: to sign in, or for a signed-in
   * viewer to pick the stamp this site uses. Null until the library has started, and once stopped. A button Swarm ID
   * refuses warns once in the console, as a library that does not start does, and leaves the session as it is.
   */
  mountButton(container: HTMLElement, options: SwarmIdButtonOptions): SwarmIdMountedButton | null;
  signOut(): Promise<void>;
  /**
   * Calls the listener on every report the frame makes once the library is ready. A stamp picked in the Swarm ID
   * window reaches the site only this way, as the same session reported again.
   */
  subscribeConnectionChange(listener: () => void): () => void;
  /** The chat history moved to another source: its Bee API base URL, or null for one with none, which changes nothing. */
  useBeeApiUrl(url: string | null): void;
  /** The stamp Swarm ID gives this site, or undefined while nobody is signed in or it gives none. */
  getPostageBatch(): Promise<SwarmIdPostageBatch | undefined>;
  /**
   * The id of the stamp the frame's newest report says this site uses, or null while it names none or nobody is signed
   * in. A sign-in starts with none until the person confirms the stamp in the Swarm ID window.
   */
  getSiteStampId(): string | null;
  /** Has the frame sign and stamp a chunk. Rejects with the code `not-authenticated` while nobody is signed in. */
  stampChunk(chunk: SwarmIdChunkToStamp): Promise<SwarmIdStampedChunk>;
  stop(): void;
}

/** The library's own code for a call that needs a signed-in session. */
const NOT_AUTHENTICATED = 'not-authenticated';

const SIGNED_OUT: SwarmIdState = { status: SWARM_ID_SIGNED_OUT, problem: null };

function stateOf(result: ReturnType<typeof swarmIdSession>): SwarmIdState {
  return result.ok
    ? { status: SWARM_ID_SIGNED_IN, session: result.session }
    : { status: SWARM_ID_SIGNED_OUT, problem: result.problem };
}

export function createSwarmIdSignIn({
  url,
  appName,
  scope,
  load,
  warn = (message) => console.warn(message),
  beeApiUrl = null,
}: SwarmIdSignInOptions): SwarmIdSignIn {
  /** The newest address asked for, handed to the client when it is built and on every change after. */
  let wantedBeeApiUrl = beeApiUrl;
  /** The address the client took last, so the same one is not sent twice. */
  let givenBeeApiUrl: string | null = null;
  /** The address sent last while the client has not answered yet. */
  let sendingBeeApiUrl: string | null = null;
  /**
   * Hands the client the newest address once it can take one, which is once it has started. A refused address leaves
   * this site's content on the one before, which still serves it, and is sent again on the next change.
   */
  const sendBeeApiUrl = () => {
    const url = wantedBeeApiUrl;
    if (!client || !isReady || url === null || url === (sendingBeeApiUrl ?? givenBeeApiUrl)) {
      return;
    }
    sendingBeeApiUrl = url;
    const isLatest = () => sendingBeeApiUrl === url;
    client.setBeeApiUrl(url).then(
      () => {
        if (isLatest()) {
          givenBeeApiUrl = url;
          sendingBeeApiUrl = null;
        }
      },
      () => {
        if (isLatest()) {
          sendingBeeApiUrl = null;
        }
      },
    );
  };
  let state: SwarmIdState = { status: SWARM_ID_STARTING };
  const listeners = new Set<() => void>();
  const connectionListeners = new Set<() => void>();
  let client: SwarmIdClient | null = null;
  let isStarted = false;
  let isReady = false;
  let isStopped = false;
  /** The newest report before the library was ready, applied once it is. */
  let reportedEarly: SwarmIdConnectionInfo | null = null;
  /** Raised by every report and every sign-out, so a chat key asked for an older session is dropped. */
  let generation = 0;
  let siteStampId: string | null = null;

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
    siteStampId = info.postageBatchId ?? null;
    if (!identity) {
      set(SIGNED_OUT);
      return;
    }
    if (!chatBinding) {
      set({ status: SWARM_ID_SIGNED_OUT, problem: SIGN_IN_INCOMPLETE });
      return;
    }
    const again =
      state.status === SWARM_ID_SIGNED_IN ? reportedAgain(state.session, identity, chatBinding, scope) : null;
    if (again) {
      set(stateOf(again));
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
        set(stateOf(result));
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
      for (const listener of [...connectionListeners]) {
        listener();
      }
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
      givenBeeApiUrl = wantedBeeApiUrl;
      load({ url, appName, onConnectionChange, ...(wantedBeeApiUrl === null ? {} : { beeApiUrl: wantedBeeApiUrl }) })
        .then((loaded) => {
          client = loaded;
          if (isStopped) {
            loaded.destroy();
            return;
          }
          return loaded.initialize().then(() => {
            isReady = true;
            sendBeeApiUrl();
            apply(reportedEarly ?? loaded.connectionInfo);
            reportedEarly = null;
          });
        })
        .catch(() => {
          warnOnce();
          set({ status: SWARM_ID_UNAVAILABLE });
        });
    },

    mountButton(container, options) {
      if (!client || !isReady || isStopped) {
        return null;
      }
      const mounted = client.mountButton(container, options);
      let isUnmounted = false;
      mounted.ready.catch(() => {
        if (!isUnmounted) {
          warnOnce();
        }
      });
      return {
        ready: mounted.ready,
        update: (next) => mounted.update(next),
        unmount() {
          isUnmounted = true;
          mounted.unmount();
        },
      };
    },

    subscribeConnectionChange(listener) {
      connectionListeners.add(listener);
      return () => connectionListeners.delete(listener);
    },

    async signOut() {
      generation += 1;
      siteStampId = null;
      set(SIGNED_OUT);
      try {
        await client?.disconnect();
      } catch {
        set({ status: SWARM_ID_SIGNED_OUT, problem: SIGN_OUT_FAILED });
      }
    },

    useBeeApiUrl(next) {
      if (next === null) {
        return;
      }
      wantedBeeApiUrl = next;
      sendBeeApiUrl();
    },

    async getPostageBatch() {
      return client && state.status === SWARM_ID_SIGNED_IN ? client.getPostageBatch() : undefined;
    },

    getSiteStampId: () => (state.status === SWARM_ID_SIGNED_IN ? siteStampId : null),

    stampChunk(chunk) {
      return client && state.status === SWARM_ID_SIGNED_IN
        ? client.stampChunk(chunk)
        : Promise.reject(Object.assign(new Error('Nobody is signed in with Swarm ID'), { code: NOT_AUTHENTICATED }));
    },

    stop() {
      isStopped = true;
      listeners.clear();
      connectionListeners.clear();
      if (hasDocument) {
        document.removeEventListener(POLICY_VIOLATION, onPolicyViolation);
      }
      client?.destroy();
    },
  };
}
