import type { MessageVerifier } from '../verify/messageVerifier';

import { compareOwnFeed, type OwnFeedComparison, readWholeChat, type WholeChat } from './ownFeedComparison';
import type { OwnFeedSource } from './useOwnFeedComparison';

/** How long a finished count, and the chat walk it was made from, answers again before it is read anew. */
export const COUNT_KEPT_MS = 3 * 60_000;

/** The most finished counts kept for one chat, the oldest let go first. */
export const MAX_KEPT_COUNTS = 32;

interface CounterOptions {
  readonly verify: MessageVerifier;
  readonly timeoutMs: number;
  readonly now?: () => number;
}

export interface OwnFeedCounter {
  /** The sender's own feed against the chat. Rejects as aborted once `signal` is, and with the comparison's errors. */
  count(sender: string, signal: AbortSignal): Promise<OwnFeedComparison>;
  /** Lets go of the sender's count and of the chat walk, so the next count reads both again. */
  forget(sender: string): void;
}

/**
 * One run shared by everyone waiting on it, with a signal of its own that is aborted only once every waiter's signal
 * is, so one closed details card does not stop a walk another still waits on.
 */
interface SharedRun<T> {
  readonly startedAt: number;
  /** Settles when the run does, as no waiter, so watching it keeps nothing running. */
  readonly settled: Promise<'done' | 'failed'>;
  join(signal: AbortSignal): Promise<T>;
}

function sharedRun<T>(startedAt: number, start: (signal: AbortSignal) => Promise<T>, onAbandoned: () => void) {
  const controller = new AbortController();
  const result = start(controller.signal);
  let waiting = 0;
  let isSettled = false;
  const settled = result.then(
    () => {
      isSettled = true;
      return 'done' as const;
    },
    () => {
      isSettled = true;
      return 'failed' as const;
    },
  );
  const run: SharedRun<T> = {
    startedAt,
    settled,
    join(signal) {
      waiting += 1;
      return new Promise<T>((resolve, reject) => {
        const leave = () => {
          waiting -= 1;
          reject(signal.reason);
          if (waiting === 0 && !isSettled) {
            controller.abort();
            onAbandoned();
          }
        };
        if (signal.aborted) {
          leave();
          return;
        }
        signal.addEventListener('abort', leave, { once: true });
        result.then(
          (value) => {
            signal.removeEventListener('abort', leave);
            resolve(value);
          },
          (error: unknown) => {
            signal.removeEventListener('abort', leave);
            reject(error);
          },
        );
      });
    },
  };
  return run;
}

interface KeptCount {
  readonly at: number;
  readonly comparison: OwnFeedComparison;
}

/**
 * Counts the own feeds of a chat's senders: one walk of the chat shared by every sender counted while it is fresh, a
 * finished count answered again for {@link COUNT_KEPT_MS}, and at most {@link MAX_KEPT_COUNTS} counts kept.
 */
export function createOwnFeedCounter(source: OwnFeedSource, options: CounterOptions): OwnFeedCounter {
  const now = options.now ?? Date.now;
  const kept = new Map<string, KeptCount>();
  const running = new Map<string, SharedRun<OwnFeedComparison>>();
  let chatWalk: SharedRun<WholeChat> | null = null;

  const isFresh = (at: number) => now() - at <= COUNT_KEPT_MS;
  const walkOptions = (signal: AbortSignal) => ({
    reads: source.reads,
    verify: options.verify,
    chatOwner: source.chatOwner,
    chatTopic: source.chatTopic,
    timeoutMs: options.timeoutMs,
    signal,
  });

  function freshChatWalk(): SharedRun<WholeChat> {
    if (chatWalk && isFresh(chatWalk.startedAt)) {
      return chatWalk;
    }
    const walk = sharedRun(
      now(),
      (signal) => readWholeChat(walkOptions(signal)),
      () => {
        if (chatWalk === walk) {
          chatWalk = null;
        }
      },
    );
    void walk.settled.then((outcome) => {
      if (outcome === 'failed' && chatWalk === walk) {
        chatWalk = null;
      }
    });
    chatWalk = walk;
    return walk;
  }

  function keep(sender: string, comparison: OwnFeedComparison) {
    kept.delete(sender);
    kept.set(sender, { at: now(), comparison });
    for (const oldest of kept.keys()) {
      if (kept.size <= MAX_KEPT_COUNTS) {
        break;
      }
      kept.delete(oldest);
    }
  }

  return {
    count(sender, signal) {
      const found = kept.get(sender);
      if (found && isFresh(found.at)) {
        return Promise.resolve(found.comparison);
      }
      const walk = freshChatWalk();
      let run = running.get(sender);
      if (!run) {
        const started = sharedRun(
          now(),
          async (runSignal) => {
            const comparison = await compareOwnFeed({
              ...walkOptions(runSignal),
              sender,
              wholeChat: walk.join(runSignal),
            });
            keep(sender, comparison);
            return comparison;
          },
          () => running.delete(sender),
        );
        run = started;
        running.set(sender, started);
        const settle = () => {
          if (running.get(sender) === started) {
            running.delete(sender);
          }
        };
        void started.settled.then(settle);
      }
      return run.join(signal);
    },
    forget(sender) {
      kept.delete(sender);
      running.delete(sender);
      chatWalk = null;
    },
  };
}
