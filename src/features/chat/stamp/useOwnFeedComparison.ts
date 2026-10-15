import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import type { ChatReads } from '../chatParts';
import { chatVerifier } from '../verify/chatVerifier';

import { compareOwnFeed, type OwnFeedComparison } from './ownFeedComparison';

/** Where a sender's own feed and the chat are read: the chat's reader on the chat history's source. */
export interface OwnFeedSource {
  readonly reads: () => ChatReads;
  readonly chatTopic: string;
  /** The chat server's feed owner. */
  readonly chatOwner: string;
}

const OwnFeedSourceContext = createContext<OwnFeedSource | null>(null);

export const OwnFeedSourceProvider = OwnFeedSourceContext.Provider;

/** The chat's own feed source, or null outside a chat. */
export function useOwnFeedSource(): OwnFeedSource | null {
  return useContext(OwnFeedSourceContext);
}

/** A whole chat and a whole own feed take many reads, so each one is given longer than a message read. */
const READ_TIMEOUT_MS = 15_000;

export const COUNTING = 'counting';
export const COUNTED = 'counted';
export const UNCOUNTABLE = 'uncountable';

export type OwnFeedCount =
  | { readonly status: typeof COUNTING }
  | { readonly status: typeof COUNTED; readonly comparison: OwnFeedComparison }
  | { readonly status: typeof UNCOUNTABLE };

/**
 * The sender's messages in the whole chat against the copies in their own feed, read when shown and again on
 * `recount`. Reads only.
 */
export function useOwnFeedComparison(source: OwnFeedSource | null, sender: string) {
  const [count, setCount] = useState<OwnFeedCount>({ status: COUNTING });
  const asked = useRef(0);

  const recount = useCallback(() => {
    if (!source) {
      return;
    }
    asked.current += 1;
    const current = asked.current;
    setCount({ status: COUNTING });
    compareOwnFeed({
      reads: source.reads,
      verify: chatVerifier(),
      chatOwner: source.chatOwner,
      chatTopic: source.chatTopic,
      sender,
      timeoutMs: READ_TIMEOUT_MS,
    }).then(
      (comparison) => {
        if (asked.current === current) {
          setCount({ status: COUNTED, comparison });
        }
      },
      () => {
        if (asked.current === current) {
          setCount({ status: UNCOUNTABLE });
        }
      },
    );
  }, [source, sender]);

  useEffect(() => {
    recount();
    return () => {
      asked.current += 1;
    };
  }, [recount]);

  return { count, recount };
}

/** "1 message" or "N messages". */
export function messagesText(count: number): string {
  return count === 1 ? '1 message' : `${count} messages`;
}
