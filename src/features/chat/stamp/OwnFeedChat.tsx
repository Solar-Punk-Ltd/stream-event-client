import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';

import type { CopyOutcome } from './ownFeedCopies';
import type { OwnFeedSource } from './useOwnFeedComparison';

/** The chat on screen while the viewer pays with their own stamp, as My Swarm counts and syncs their own feed. */
export interface OwnFeedChat {
  readonly source: OwnFeedSource;
  /** The viewer's chat address, which owns their own feed. */
  readonly sender: string;
  /** Writes a sent message's copy into the viewer's own feed, through the chat's own write. */
  readonly copy: (messageId: string, payload: Uint8Array) => Promise<CopyOutcome>;
}

interface OwnFeedChatValue {
  readonly current: OwnFeedChat | null;
  readonly share: (chat: OwnFeedChat | null) => void;
}

const OwnFeedChatContext = createContext<OwnFeedChatValue>({ current: null, share: () => {} });

export function OwnFeedChatProvider({ children }: { readonly children: ReactNode }) {
  const [current, share] = useState<OwnFeedChat | null>(null);
  const value = useMemo(() => ({ current, share }), [current]);
  return <OwnFeedChatContext.Provider value={value}>{children}</OwnFeedChatContext.Provider>;
}

/** The chat whose own feed My Swarm shows, or null while no chat on the viewer's own stamp is on screen. */
export function useOwnFeedChat(): OwnFeedChat | null {
  return useContext(OwnFeedChatContext).current;
}

/** Shows `chat` to My Swarm for as long as it is given, and takes it away when it goes. */
export function useShareOwnFeedChat(chat: OwnFeedChat | null): void {
  const { share } = useContext(OwnFeedChatContext);
  useEffect(() => {
    share(chat);
    return () => share(null);
  }, [chat, share]);
}
