import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import type { ChatReads } from '../chatParts';
import { chatVerifier } from '../verify/chatVerifier';

import {
  ChatNotReadYetError,
  compareOwnFeed,
  type OwnFeedComparison,
  OwnFeedRefusedError,
  OwnFeedTooLargeError,
} from './ownFeedComparison';

/** Where a sender's own feed and the chat are read: the chat's reader on the chat history's source. */
export interface OwnFeedSource {
  readonly reads: () => ChatReads;
  readonly chatTopic: string;
  /** The chat server's feed owner. */
  readonly chatOwner: string;
  /** The newest feed index the chat on screen holds now, or null when it holds none, read as each check starts. */
  readonly knownNewestIndex: () => number | null;
}

const OwnFeedSourceContext = createContext<OwnFeedSource | null>(null);

export const OwnFeedSourceProvider = OwnFeedSourceContext.Provider;

/** The chat's own feed source, or null outside a chat. */
export function useOwnFeedSource(): OwnFeedSource | null {
  return useContext(OwnFeedSourceContext);
}

/** A whole chat and a whole own feed take many reads, so each one is given longer than a message read. */
const READ_TIMEOUT_MS = 15_000;

export const NOT_CHECKED = 'not-checked';
export const CHECKING = 'checking';
export const CHECKED = 'checked';
export const UNREADABLE = 'unreadable';
export const TOO_LARGE = 'too-large';
export const REFUSED = 'refused';
export const CHAT_NOT_READ_YET = 'chat-not-read-yet';

type OwnFeedCheck =
  | { readonly status: typeof NOT_CHECKED }
  | { readonly status: typeof CHECKING; readonly checked: number; readonly planned: number }
  | { readonly status: typeof CHECKED; readonly comparison: OwnFeedComparison }
  | { readonly status: typeof UNREADABLE }
  | { readonly status: typeof TOO_LARGE }
  | { readonly status: typeof REFUSED }
  | { readonly status: typeof CHAT_NOT_READ_YET };

const NOTHING_CHECKED: OwnFeedCheck = { status: NOT_CHECKED };

function failedCheck(error: unknown): OwnFeedCheck {
  if (error instanceof OwnFeedRefusedError) {
    return { status: REFUSED };
  }
  if (error instanceof ChatNotReadYetError) {
    return { status: CHAT_NOT_READ_YET };
  }
  return { status: error instanceof OwnFeedTooLargeError ? TOO_LARGE : UNREADABLE };
}

/**
 * The sender's messages in the whole chat against the copies in their own feed, read only when `check` is called and
 * then read whole and afresh, nothing kept from an earlier check. A check shows how far it has got, unless it is quiet,
 * which keeps the last result on screen until the new one is made. `stop`, a new check and leaving the screen each end
 * the reads of the one running. Reads only.
 */
export function useOwnFeedComparison(source: OwnFeedSource | null, sender: string) {
  const [state, setState] = useState<OwnFeedCheck>(NOTHING_CHECKED);
  const running = useRef<AbortController | null>(null);

  const check = useCallback(
    (isQuiet = false) => {
      if (!source) {
        return;
      }
      running.current?.abort();
      const controller = new AbortController();
      running.current = controller;
      const isCurrent = () => !controller.signal.aborted;
      let planned = 0;
      let checked = 0;
      const showProgress = () => {
        if (!isQuiet && isCurrent()) {
          setState({ status: CHECKING, checked: Math.min(checked, planned), planned });
        }
      };
      showProgress();
      compareOwnFeed({
        reads: source.reads,
        verify: chatVerifier(),
        chatOwner: source.chatOwner,
        chatTopic: source.chatTopic,
        knownNewestIndex: source.knownNewestIndex(),
        sender,
        timeoutMs: READ_TIMEOUT_MS,
        signal: controller.signal,
        progress: {
          planned: (entries) => {
            planned += entries;
            showProgress();
          },
          checked: (entries) => {
            checked += entries;
            showProgress();
          },
        },
      }).then(
        (comparison) => {
          if (isCurrent()) {
            setState({ status: CHECKED, comparison });
          }
        },
        (error: unknown) => {
          if (isCurrent()) {
            setState(failedCheck(error));
          }
        },
      );
    },
    [source, sender],
  );

  const stop = useCallback(() => {
    running.current?.abort();
    running.current = null;
    setState(NOTHING_CHECKED);
  }, []);

  useEffect(() => () => running.current?.abort(), [source, sender]);

  return { state, check, stop };
}

/** Said by the check in a message's details and by the count in My Swarm when the chat on screen is ahead of what the source serves. */
export const CHAT_NOT_READ_YET_TEXT = 'The chat could not be read yet. Try again in a moment.';

/** "1 message" or "N messages". */
export function messagesText(count: number): string {
  return `${count} ${oneOrMany(count, 'message', 'messages')}`;
}

/** `one` for a count of 1 and `many` for any other, so a word such as is or are agrees with the count it follows. */
export function oneOrMany(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
