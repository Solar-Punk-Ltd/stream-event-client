import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type ChatEvent,
  type ChatIdentity,
  type ChatMessage,
  type ChatEventPayloads,
  type ChatSettings,
  EVENTS,
  FeedStatus,
  type MessageData,
  MessageType,
  SwarmChat,
} from '@solarpunkltd/swarm-chat-js';

import { type ChatReads, chatParts, type ChatPartsForPage } from './chatParts';
import { draftProblem } from './draftCheck';
import { groupReactions, type ReactionsByMessage } from './reactions';

import type { ChunkStamper, SendProblem, StampedPush } from './stamp/ownStampWrite';
import { chatVerifier } from './verify/chatVerifier';

/** Where a message stands on its way from this browser to the chat feed, as the library's sender reports it. */
interface DeliveryState {
  /** Built and signed, about to be written to the chat's shared address. */
  requested?: boolean;
  /** The node took the first write. The library resends it until it reads the message back. */
  uploaded?: boolean;
  /** Read back from the chat feed, so everyone watching can see it. */
  received?: boolean;
  /** The resends ran out without the message being read back. */
  error?: boolean;
}

/** A message whose signature, and Swarm ID binding if it carries one, passed the check for this page. */
interface CheckedMessage extends MessageData {
  /** The Swarm ID account that vouched for the sender, or null for a guest. */
  identity: ChatIdentity | null;
}

export interface VisibleMessage extends CheckedMessage, DeliveryState {
  /** Why the viewer's own stamp did not send it, the last time it tried. */
  sendProblem?: string;
}

/** What a chat on the viewer's own stamp needs beside its settings. */
export interface OwnStampSetup {
  /** Read at every write: Swarm ID while the viewer is signed in with it, null otherwise. */
  readonly stamper: () => ChunkStamper | null;
  readonly ownFeed: boolean;
  /** Read at every write: why the page cannot send on the viewer's stamp now, or null when it can. */
  readonly refusal: () => string | null;
  /** Told after every message the viewer's node took. */
  readonly onSent?: () => void;
  /** Read at every write: how a stamped chunk goes out through the node in this browser, or null while it does not. */
  readonly push?: () => StampedPush | null;
}

export const CHAT_LOADING = 'loading';
export const CHAT_READY = 'ready';
export const CHAT_UNREACHABLE = 'unreachable';

export type ChatStatus = typeof CHAT_LOADING | typeof CHAT_READY | typeof CHAT_UNREACHABLE;

const PENDING_INDEX = -1;

/**
 * Published messages by their place in the chat feed, then pending ones by the sender's clock, as the library orders
 * them. A timestamp cannot order the two kinds together: a published one is the server's, a pending one the sender's.
 */
function inChatOrder(a: MessageData, b: MessageData): number {
  const aPending = a.index === PENDING_INDEX;
  const bPending = b.index === PENDING_INDEX;
  if (aPending !== bPending) {
    return aPending ? 1 : -1;
  }
  return aPending ? a.timestamp - b.timestamp : a.index - b.index;
}

/**
 * A message drawn only from what was verified. The feed's place and the server's receive time are the library's, and
 * every field the message says itself is read from the signed message rather than from the event's copies of it.
 */
function checkedMessage(data: MessageData, message: ChatMessage, identity: ChatIdentity | null): CheckedMessage {
  return {
    id: message.id,
    type: message.type,
    message: message.text,
    username: message.name,
    address: message.addr,
    ...(message.target ? { targetMessageId: message.target } : {}),
    index: data.index,
    timestamp: data.index === PENDING_INDEX ? message.ts : data.timestamp,
    signedMessage: message,
    identity,
  };
}

/** One entry per message id, the latest delivery state laid over what was known, in chat order. */
export function mergeMessage(
  messages: VisibleMessage[],
  incoming: CheckedMessage,
  delivery: DeliveryState,
): VisibleMessage[] {
  const index = messages.findIndex((message) => message.id === incoming.id);
  const merged =
    index === -1
      ? [...messages, { ...incoming, ...delivery }]
      : messages.map((message, at) => (at === index ? { ...message, ...incoming, ...delivery } : message));
  return merged.sort(inChatOrder);
}

/**
 * The chat is started a tick after the effect runs rather than inside it. StrictMode mounts every
 * effect, unmounts it and mounts it again in one go, and a start inside the effect would open a second
 * chat, with its own polling, for each of those passes.
 */
const START_DELAY_MS = 0;

/**
 * One chat for the settings given, stopped when they change and when the component goes away. The
 * settings are compared by value, so a caller may build a new object on every render.
 *
 * A new name restarts the chat too, because the library takes its key once, when it is created. The
 * messages on screen stay through that restart, since it is the same chat read again, and only a
 * different stream's chat starts from an empty list.
 *
 * @param reads The Swarm client's chat reader as it is now. Called on every read rather than held, so
 *   a client rebuilt for another node is followed without restarting the chat.
 */
export function useSwarmChat(
  settings: ChatSettings,
  ownAddress: string | null,
  reads: () => ChatReads,
  ownStamp: OwnStampSetup | null = null,
) {
  const settingsKey = JSON.stringify(settings);
  // Who pays and where a message is written change how it is sent, not which chat is on screen.
  const { via: _via, writeUrl: _writeUrl, ...where } = settings.infra;
  const chatKey = JSON.stringify(where);
  const ownFeed = ownStamp?.ownFeed ?? false;
  const ownStampRef = useRef(ownStamp);
  ownStampRef.current = ownStamp;
  const partsRef = useRef<ChatPartsForPage | null>(null);
  const chatRef = useRef<SwarmChat | null>(null);
  const shownChatKeyRef = useRef(chatKey);
  const readsRef = useRef(reads);
  readsRef.current = reads;

  const [restarts, setRestarts] = useState(0);
  const [messages, setMessages] = useState<VisibleMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>(CHAT_LOADING);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [feedStatus, setFeedStatus] = useState<FeedStatus | null>(null);
  const [refusedCount, setRefusedCount] = useState(0);
  const [sendProblems, setSendProblems] = useState<Record<string, SendProblem>>({});
  /** The refused messages of the chat on screen, so one carried by several events is counted once. */
  const refusedRef = useRef(new Set<string>());

  useEffect(() => {
    const current = JSON.parse(settingsKey) as ChatSettings;
    const { via: _currentVia, writeUrl: _currentWriteUrl, ...currentWhere } = current.infra;
    const currentChatKey = JSON.stringify(currentWhere);
    if (shownChatKeyRef.current !== currentChatKey) {
      shownChatKeyRef.current = currentChatKey;
      setMessages([]);
      refusedRef.current = new Set();
      setRefusedCount(0);
      setSendProblems({});
      setStatus(CHAT_LOADING);
      setHasOlder(false);
      setIsLoadingOlder(false);
    } else {
      // A chat started again, for a new name or on request, has not failed yet.
      setStatus((previous) => (previous === CHAT_UNREACHABLE ? CHAT_LOADING : previous));
    }
    let stopped = false;
    let chat: SwarmChat | null = null;
    /** The library keeps its listeners through a stop, so each one added here is taken off again here. */
    const removeListeners: Array<() => void> = [];

    setFeedStatus(null);

    const timer = setTimeout(() => {
      const parts = chatParts(current, () => readsRef.current(), {
        stamper: () => ownStampRef.current?.stamper() ?? null,
        ownFeed,
        refusal: () => ownStampRef.current?.refusal() ?? null,
        onProblem: (id, problem) => {
          if (!stopped) {
            setSendProblems((previous) => ({ ...previous, [id]: problem }));
          }
        },
        onSent: () => ownStampRef.current?.onSent?.(),
        push: () => ownStampRef.current?.push?.() ?? null,
      });
      partsRef.current = parts;
      const started = new SwarmChat(current, { source: parts.source, write: parts.write });
      chat = started;
      chatRef.current = started;

      const { on, off } = started.getEmitter();
      const listen = <E extends ChatEvent>(event: E, listener: (data: ChatEventPayloads[E]) => void) => {
        on(event, listener);
        removeListeners.push(() => off(event, listener));
      };
      const onMessage = (delivery: DeliveryState) => (data: MessageData) => {
        // verify never rejects. The events of one message carry the same signed message, so their verdicts
        // come back in the order they were asked for.
        void chatVerifier()
          .verify(data.signedMessage)
          .then((verdict) => {
            if (stopped) {
              return;
            }
            if (verdict.ok) {
              setMessages((previous) =>
                mergeMessage(previous, checkedMessage(data, verdict.message, verdict.identity), delivery),
              );
              return;
            }
            const key = JSON.stringify(data.signedMessage) ?? data.id;
            if (!refusedRef.current.has(key)) {
              refusedRef.current.add(key);
              setRefusedCount((count) => count + 1);
            }
          });
      };

      listen(EVENTS.MESSAGE_REQUEST_INITIATED, onMessage({ error: false, requested: true }));
      listen(EVENTS.MESSAGE_REQUEST_UPLOADED, onMessage({ error: false, uploaded: true }));
      const onReceived = onMessage({ error: false, received: true });
      listen(EVENTS.MESSAGE_RECEIVED, (data: MessageData) => {
        setSendProblems((previous) => {
          if (!(data.id in previous)) {
            return previous;
          }
          const { [data.id]: _published, ...rest } = previous;
          return rest;
        });
        onReceived(data);
      });
      listen(EVENTS.MESSAGE_REQUEST_ERROR, onMessage({ error: true }));
      listen(EVENTS.LOADING_INIT, (loading: boolean) => {
        if (stopped) {
          return;
        }
        if (!loading) {
          setHasOlder(started.hasPreviousMessages());
        }
        // The library keeps trying after a critical error, so the end of a load shows the chat whatever came
        // before. Once a chat has shown, a restart for a new name reads it again behind what is on screen.
        setStatus((previous) =>
          !loading ? CHAT_READY : previous === CHAT_UNREACHABLE || previous === CHAT_READY ? previous : CHAT_LOADING,
        );
      });
      listen(EVENTS.LOADING_PREVIOUS_MESSAGES, (loading: boolean) => {
        if (stopped) {
          return;
        }
        setIsLoadingOlder(loading);
        if (!loading) {
          setHasOlder(started.hasPreviousMessages());
        }
      });
      listen(EVENTS.STATUS, (next) => {
        if (!stopped) {
          setFeedStatus(next);
        }
      });
      listen(EVENTS.CRITICAL_ERROR, () => {
        if (!stopped) {
          setStatus(CHAT_UNREACHABLE);
        }
      });

      started.start().catch(() => {
        if (!stopped) {
          setStatus(CHAT_UNREACHABLE);
        }
      });
    }, START_DELAY_MS);

    return () => {
      stopped = true;
      clearTimeout(timer);
      for (const removeListener of removeListeners.splice(0)) {
        removeListener();
      }
      if (chat) {
        if (chatRef.current === chat) {
          chatRef.current = null;
        }
        void chat.stop();
      }
    };
  }, [settingsKey, ownFeed, restarts]);

  const shown = useMemo(
    () =>
      messages.map((message) => {
        const problem = message.received ? undefined : sendProblems[message.id];
        return problem ? { ...message, sendProblem: problem.text, error: message.error || problem.final } : message;
      }),
    [messages, sendProblems],
  );

  const grouped = useMemo(() => {
    const text: VisibleMessage[] = [];
    const reactions: MessageData[] = [];
    const replies: VisibleMessage[] = [];
    for (const message of shown) {
      if (message.type === MessageType.TEXT) {
        text.push(message);
      } else if (message.type === MessageType.REACTION && !message.error) {
        reactions.push(message);
      } else if (message.type === MessageType.THREAD) {
        replies.push(message);
      }
    }
    return { text, reactions, replies };
  }, [shown]);

  const reactionsByMessage: ReactionsByMessage = useMemo(
    () => groupReactions(grouped.reactions, ownAddress),
    [grouped.reactions, ownAddress],
  );

  const repliesTo = useCallback(
    (parentId: string) => grouped.replies.filter((reply) => reply.targetMessageId === parentId),
    [grouped.replies],
  );

  const send = useCallback(async (text: string, type: MessageType, targetMessageId?: string) => {
    await chatRef.current?.sendMessage(text, type, targetMessageId);
  }, []);

  const sendMessage = useCallback((text: string) => send(text, MessageType.TEXT), [send]);
  const sendReaction = useCallback(
    (targetMessageId: string, emoji: string) => send(emoji, MessageType.REACTION, targetMessageId),
    [send],
  );
  const sendReply = useCallback((parentId: string, text: string) => send(text, MessageType.THREAD, parentId), [send]);

  const { chatTopic, via } = settings.infra;
  const { nickname, binding } = settings.user;
  const checkMessage = useCallback(
    (text: string) => draftProblem({ topic: chatTopic, name: nickname, type: MessageType.TEXT, text, via, binding }),
    [chatTopic, nickname, via, binding],
  );
  const checkReply = useCallback(
    (parentId: string, text: string) =>
      draftProblem({
        topic: chatTopic,
        name: nickname,
        type: MessageType.THREAD,
        target: parentId,
        text,
        via,
        binding,
      }),
    [chatTopic, nickname, via, binding],
  );

  const fetchOlderMessages = useCallback(async () => {
    try {
      await chatRef.current?.fetchPreviousMessages();
    } catch {
      // A snapshot that cannot be read now is offered again: the button stays while there is more.
    }
  }, []);

  /** A message that failed, or one still waiting to be read back, is sent again with its identical bytes. */
  const retrySendMessage = useCallback((message: VisibleMessage) => {
    partsRef.current?.forgetRefusal(message.id);
    setSendProblems(({ [message.id]: _retried, ...rest }) => rest);
    chatRef.current?.retrySendMessage(message);
  }, []);

  const restart = useCallback(() => setRestarts((count) => count + 1), []);

  return {
    status,
    feedStatus,
    isLoadingOlder,
    hasOlder,
    messages: grouped.text,
    reactionsByMessage,
    repliesTo,
    sendMessage,
    sendReaction,
    sendReply,
    checkMessage,
    checkReply,
    fetchOlderMessages,
    retrySendMessage,
    restart,
    /** Messages the chat delivered that failed their check, never shown. */
    refusedCount,
  };
}
