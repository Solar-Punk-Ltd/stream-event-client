import type { VerifyScope } from '../verify/verdicts';

import {
  isWindowBlocked,
  type LoadSwarmIdClient,
  type SwarmIdChunkToStamp,
  type SwarmIdClient,
  type SwarmIdConnectionInfo,
  type SwarmIdPostageBatch,
  type SwarmIdStampedChunk,
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

export const STAMP_WINDOW_OPENED = 'opened';
export const STAMP_WINDOW_BLOCKED = 'blocked';
export const STAMP_WINDOW_FAILED = 'failed';

/** What became of the Swarm ID window opened to change this site's stamp. */
export type StampWindowOutcome =
  | typeof STAMP_WINDOW_OPENED
  | typeof STAMP_WINDOW_BLOCKED
  /** It did not open, or nobody is signed in to change a stamp for. */
  | typeof STAMP_WINDOW_FAILED;

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
  /**
   * The Bee API base URL of the source the viewer picked for the chat history, which this site's content in Swarm ID
   * follows, or null for a source with no such address.
   */
  beeApiUrl?: string | null;
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
  /**
   * Opens the Swarm ID window again for a signed-in viewer, where the person picks the stamp this site uses. Call it
   * from a click only. A blocked window leaves the viewer signed in.
   */
  changeStamp(): Promise<StampWindowOutcome>;
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

    changeStamp() {
      if (!client || state.status !== SWARM_ID_SIGNED_IN) {
        return Promise.resolve(STAMP_WINDOW_FAILED);
      }
      return client.connect().then(
        () => STAMP_WINDOW_OPENED,
        (error: unknown) => (isWindowBlocked(error) ? STAMP_WINDOW_BLOCKED : STAMP_WINDOW_FAILED),
      );
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
