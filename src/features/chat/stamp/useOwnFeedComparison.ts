import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import type { ChatReads } from '../chatParts';
import { chatVerifier } from '../verify/chatVerifier';

import { type OwnFeedComparison, OwnFeedTooLargeError } from './ownFeedComparison';
import { createOwnFeedCounter, type OwnFeedCounter } from './ownFeedCounter';

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
export const TOO_LARGE = 'too-large';

type OwnFeedCount =
  | { readonly status: typeof COUNTING }
  | { readonly status: typeof COUNTED; readonly comparison: OwnFeedComparison }
  | { readonly status: typeof UNCOUNTABLE }
  | { readonly status: typeof TOO_LARGE };

const counters = new WeakMap<OwnFeedSource, OwnFeedCounter>();

/** The one counter of a chat on screen, so every details card and My stamp share its walk of the chat. */
function counterOf(source: OwnFeedSource): OwnFeedCounter {
  let counter = counters.get(source);
  if (!counter) {
    counter = createOwnFeedCounter(source, { verify: chatVerifier(), timeoutMs: READ_TIMEOUT_MS });
    counters.set(source, counter);
  }
  return counter;
}

/**
 * The sender's messages in the whole chat against the copies in their own feed, read when shown, answered from a count
 * made a moment ago where there is one, and read anew on `recount`. Every read stops when it is hidden or recounted.
 * Reads only.
 */
export function useOwnFeedComparison(source: OwnFeedSource | null, sender: string) {
  const [count, setCount] = useState<OwnFeedCount>({ status: COUNTING });
  const reading = useRef<AbortController | null>(null);

  const start = useCallback(
    (isFresh: boolean) => {
      if (!source) {
        return;
      }
      reading.current?.abort();
      const controller = new AbortController();
      reading.current = controller;
      const counter = counterOf(source);
      if (isFresh) {
        counter.forget(sender);
      }
      setCount({ status: COUNTING });
      counter.count(sender, controller.signal).then(
        (comparison) => {
          if (!controller.signal.aborted) {
            setCount({ status: COUNTED, comparison });
          }
        },
        (error: unknown) => {
          if (!controller.signal.aborted) {
            setCount({ status: error instanceof OwnFeedTooLargeError ? TOO_LARGE : UNCOUNTABLE });
          }
        },
      );
    },
    [source, sender],
  );

  const recount = useCallback(() => start(true), [start]);

  useEffect(() => {
    start(false);
    return () => reading.current?.abort();
  }, [start]);

  return { count, recount };
}

/** "1 message" or "N messages". */
export function messagesText(count: number): string {
  return count === 1 ? '1 message' : `${count} messages`;
}
