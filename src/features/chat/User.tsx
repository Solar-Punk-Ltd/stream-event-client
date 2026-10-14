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
import { LoginModal } from './LoginModal/LoginModal';
import { type LoadSwarmIdClient, loadSwarmIdLibrary } from './swarmId/swarmIdClient';
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
  /** Signs in and closes the dialog, or hands back why the name was refused. */
  loginAsUser: (name: string) => DisplayNameCheck;
  /** Leaves as a guest, forgetting the name and the key this browser kept. */
  logout: () => void;
  /** Null on a deployment that offers no Swarm ID. */
  swarmId: SwarmIdState | null;
  swarmIdSession: SwarmIdSession | null;
  /** Opens the Swarm ID window. Called from a click only, or the browser blocks the window. */
  signInWithSwarmId: () => void;
  signOutOfSwarmId: () => void;
  isLoginModalOpen: boolean;
  setIsLoginModalOpen: (open: boolean) => void;
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
): [SwarmIdState | null, SwarmIdSignIn | null] {
  const [signIn] = useState(() =>
    url ? createSwarmIdSignIn({ url, appName, scope: pageScope(window.location), load }) : null,
  );
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

/** Who the viewer is in the chat, and the dialog that asks for a name. A guest is remembered by this browser. */
export function ChatUserProvider({
  children,
  swarmIdUrl = null,
  appName = '',
  loadSwarmIdClient = loadSwarmIdLibrary,
}: ChatUserProviderProps) {
  const [guestSession, setGuestSession] = useState<Session | null>(restoreUserSession);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [swarmId, signIn] = useSwarmIdSignIn(swarmIdUrl, appName, loadSwarmIdClient);

  const loginAsUser = useCallback((name: string): DisplayNameCheck => {
    const checked = checkDisplayName(name);
    if (!checked.ok) {
      return checked;
    }
    const next = nicknameLogin(checked.name);
    persistUserSession(next);
    setGuestSession(next);
    setIsLoginModalOpen(false);
    return checked;
  }, []);

  const logout = useCallback(() => {
    purgeUserSession();
    setGuestSession(null);
  }, []);

  const signInWithSwarmId = useCallback(() => signIn?.signIn(), [signIn]);
  const signOutOfSwarmId = useCallback(() => void signIn?.signOut(), [signIn]);

  const swarmIdSession = swarmId?.status === SWARM_ID_SIGNED_IN ? swarmId.session : null;
  const session = swarmIdSession ?? guestSession;

  useEffect(() => {
    if (swarmIdSession) {
      setIsLoginModalOpen(false);
    }
  }, [swarmIdSession]);

  const value = useMemo(
    () => ({
      session,
      guestSession,
      loginAsUser,
      logout,
      swarmId,
      swarmIdSession,
      signInWithSwarmId,
      signOutOfSwarmId,
      isLoginModalOpen,
      setIsLoginModalOpen,
    }),
    [
      session,
      guestSession,
      loginAsUser,
      logout,
      swarmId,
      swarmIdSession,
      signInWithSwarmId,
      signOutOfSwarmId,
      isLoginModalOpen,
    ],
  );

  return (
    <ChatUserContext.Provider value={value}>
      {children}
      {isLoginModalOpen && <LoginModal />}
    </ChatUserContext.Provider>
  );
}
