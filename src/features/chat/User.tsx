import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';

import { checkDisplayName, type DisplayNameCheck, nicknameLogin, type Session } from './auth/login';
import { persistUserSession, purgeUserSession, restoreUserSession } from './auth/persistence';
import {
  type LoadSwarmIdClient,
  loadSwarmIdLibrary,
  type SwarmIdButtonOptions,
  type SwarmIdChunkToStamp,
  type SwarmIdMountedButton,
  type SwarmIdPostageBatch,
  type SwarmIdStampedChunk,
} from './swarmId/swarmIdClient';
import {
  createSwarmIdSignIn,
  SWARM_ID_SIGNED_IN,
  type SwarmIdSignIn,
  type SwarmIdState,
} from './swarmId/swarmIdSignIn';
import type { SwarmIdSession } from './swarmId/swarmIdSession';
import { pageScope } from './verify/verdicts';

interface ChatUserContextValue {
  /**
   * Who the viewer chats as: the Swarm ID session when there is one, else the guest. Null for a viewer who has done
   * neither, who can read the chat and not write to it.
   */
  session: Session | null;
  /** The name and key this browser keeps for a guest, kept while the viewer is also signed in with Swarm ID. */
  guestSession: Session | null;
  /** Chats as a guest under the name, or hands back why the name was refused. */
  loginAsUser: (name: string) => DisplayNameCheck;
  /** Leaves as a guest, forgetting the name and the key this browser kept. */
  logout: () => void;
  /** Null on a deployment that offers no Swarm ID. */
  swarmId: SwarmIdState | null;
  swarmIdSession: SwarmIdSession | null;
  /**
   * Shows Swarm ID's button in the container, whose click opens the Swarm ID window to sign in or to pick this site's
   * stamp. Null while Swarm ID has not started, or on a deployment that offers none.
   */
  mountSwarmIdButton: (container: HTMLElement, options: SwarmIdButtonOptions) => SwarmIdMountedButton | null;
  signOutOfSwarmId: () => void;
  /** The stamp Swarm ID gives this site, or undefined while nobody is signed in or it gives none. */
  getSiteStamp: () => Promise<SwarmIdPostageBatch | undefined>;
  /** The id of the stamp Swarm ID's newest report names for this site, or null while it names none. */
  getSiteStampId: () => string | null;
  /** Hears of every report Swarm ID makes about the session, a stamp picked in its window among them. */
  onSwarmIdConnectionChange: (listener: () => void) => () => void;
  /** Has Swarm ID sign and stamp a chunk with the stamp it gives this site. Rejects while nobody is signed in. */
  stampChunk: (chunk: SwarmIdChunkToStamp) => Promise<SwarmIdStampedChunk>;
}

const ChatUserContext = createContext<ChatUserContextValue | undefined>(undefined);

export function useChatUser(): ChatUserContextValue {
  const context = useContext(ChatUserContext);
  if (!context) {
    throw new Error('useChatUser must be used within ChatUserProvider');
  }
  return context;
}

interface ChatUserProviderProps {
  children: ReactNode;
  /** The Swarm ID site to offer sign-in with, or nothing for a guest name only. */
  swarmIdUrl?: string | null;
  /** What the Swarm ID window calls this site. */
  appName?: string;
  loadSwarmIdClient?: LoadSwarmIdClient;
  /**
   * The Bee API base URL of the source the viewer picked for the chat history, which Swarm ID reads and writes this
   * site's content through, or null for a source with none.
   */
  beeApiUrl?: string | null;
}

const NO_SWARM_ID = (): null => null;
const NO_LISTENER = () => () => {};

/**
 * The Swarm ID sign-in for the page, started a tick after its effect runs, so StrictMode's second mount starts one
 * library and one frame rather than two.
 */
function useSwarmIdSignIn(
  url: string | null,
  appName: string,
  load: LoadSwarmIdClient,
  beeApiUrl: string | null,
): [SwarmIdState | null, SwarmIdSignIn | null] {
  const [signIn] = useState(() =>
    url ? createSwarmIdSignIn({ url, appName, scope: pageScope(window.location), load, beeApiUrl }) : null,
  );
  useEffect(() => signIn?.useBeeApiUrl(beeApiUrl), [signIn, beeApiUrl]);
  useEffect(() => {
    if (!signIn) {
      return;
    }
    let isStarted = false;
    const timer = setTimeout(() => {
      isStarted = true;
      signIn.start();
    }, 0);
    return () => {
      clearTimeout(timer);
      if (isStarted) {
        signIn.stop();
      }
    };
  }, [signIn]);
  const state = useSyncExternalStore(signIn ? signIn.subscribe : NO_LISTENER, signIn ? signIn.getState : NO_SWARM_ID);
  return [state, signIn];
}

/** Who the viewer is in the chat. A guest is remembered by this browser. */
export function ChatUserProvider({
  children,
  swarmIdUrl = null,
  appName = '',
  loadSwarmIdClient = loadSwarmIdLibrary,
  beeApiUrl = null,
}: ChatUserProviderProps) {
  const [guestSession, setGuestSession] = useState<Session | null>(restoreUserSession);
  const [swarmId, signIn] = useSwarmIdSignIn(swarmIdUrl, appName, loadSwarmIdClient, beeApiUrl);

  const loginAsUser = useCallback((name: string): DisplayNameCheck => {
    const checked = checkDisplayName(name);
    if (!checked.ok) {
      return checked;
    }
    const next = nicknameLogin(checked.name);
    persistUserSession(next);
    setGuestSession(next);
    return checked;
  }, []);

  const logout = useCallback(() => {
    purgeUserSession();
    setGuestSession(null);
  }, []);

  const mountSwarmIdButton = useCallback(
    (container: HTMLElement, options: SwarmIdButtonOptions) => signIn?.mountButton(container, options) ?? null,
    [signIn],
  );
  const signOutOfSwarmId = useCallback(() => void signIn?.signOut(), [signIn]);
  const getSiteStamp = useCallback(async () => signIn?.getPostageBatch(), [signIn]);
  const getSiteStampId = useCallback(() => signIn?.getSiteStampId() ?? null, [signIn]);
  const onSwarmIdConnectionChange = useCallback(
    (listener: () => void) => (signIn ? signIn.subscribeConnectionChange(listener) : () => {}),
    [signIn],
  );
  const stampChunk = useCallback(
    (chunk: SwarmIdChunkToStamp) =>
      signIn ? signIn.stampChunk(chunk) : Promise.reject(new Error('This deployment offers no Swarm ID')),
    [signIn],
  );

  const swarmIdSession = swarmId?.status === SWARM_ID_SIGNED_IN ? swarmId.session : null;
  const session = swarmIdSession ?? guestSession;

  const value = useMemo(
    () => ({
      session,
      guestSession,
      loginAsUser,
      logout,
      swarmId,
      swarmIdSession,
      mountSwarmIdButton,
      signOutOfSwarmId,
      getSiteStamp,
      getSiteStampId,
      onSwarmIdConnectionChange,
      stampChunk,
    }),
    [
      session,
      guestSession,
      loginAsUser,
      logout,
      swarmId,
      swarmIdSession,
      mountSwarmIdButton,
      signOutOfSwarmId,
      getSiteStamp,
      getSiteStampId,
      onSwarmIdConnectionChange,
      stampChunk,
    ],
  );

  return <ChatUserContext.Provider value={value}>{children}</ChatUserContext.Provider>;
}
