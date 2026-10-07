import { useCallback, useId, useMemo, useState } from 'react';

import { FeedStatus } from '@solarpunkltd/swarm-chat-js';

import type { ChatConfig } from '@/config/runtimeConfig';
import { Button, ButtonVariant } from '@/shared/components/Button/Button';

import type { ChatReads } from '../chatParts';
import { chatSettings } from '../chatSettings';
import { useChatUser } from '../User';
import { CHAT_LOADING, CHAT_UNREACHABLE, useSwarmChat, type VisibleMessage } from '../useSwarmChat';

import { ChatMessage } from './ChatMessage/ChatMessage';
import { FeedNotice } from './FeedNotice/FeedNotice';
import { MessageSender } from './MessageSender/MessageSender';
import { ScrollableMessageList } from './ScrollableMessageList/ScrollableMessageList';
import { ThreadView } from './ThreadView/ThreadView';

import './Chat.scss';

export { READ_ONLY_PRIVATE_KEY } from '../chatSettings';

interface ChatProps {
  chat: ChatConfig;
  /** The stream's topic, which names the stream's chat. */
  topic: string;
  /** The Swarm client's chat reader as it is now, which the chat reads through. */
  reads: () => ChatReads;
}

/** The reaction being sent, one per message, keyed by message id. */
type PendingReactions = Record<string, string>;

/** The chat beside a stream: read by anyone, written to by a viewer who has chosen a name. */
export function Chat({ chat, topic, reads }: ChatProps) {
  const { session, setIsLoginModalOpen } = useChatUser();
  const settings = useMemo(() => chatSettings(chat, topic, session), [chat, topic, session]);
  const ownAddress = session?.address ?? null;
  const {
    status,
    feedStatus,
    isLoadingOlder,
    hasOlder,
    messages,
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
  } = useSwarmChat(settings, ownAddress, reads);

  const [threadId, setThreadId] = useState<string | null>(null);
  const [pendingReactions, setPendingReactions] = useState<PendingReactions>({});
  const [isFolded, setIsFolded] = useState(false);
  const bodyId = useId();

  const askForName = useCallback(() => setIsLoginModalOpen(true), [setIsLoginModalOpen]);
  /** Before the library has reported a state nothing has gone wrong, so that counts as live. */
  const isFeedLive = feedStatus === null || feedStatus === FeedStatus.LIVE;

  const react = useCallback(
    async (messageId: string, emoji: string) => {
      if (!session) {
        askForName();
        return;
      }
      if (pendingReactions[messageId]) {
        return;
      }
      setPendingReactions((pending) => ({ ...pending, [messageId]: emoji }));
      try {
        await sendReaction(messageId, emoji);
      } catch {
        // A reaction that fails leaves the count as it was, which is what the viewer sees.
      } finally {
        setPendingReactions(({ [messageId]: _, ...rest }) => rest);
      }
    },
    [session, askForName, pendingReactions, sendReaction],
  );

  const renderMessage = (message: VisibleMessage, onHeightChange?: () => void, inThread = false) => (
    <ChatMessage
      key={message.id}
      message={message}
      ownMessage={message.address === ownAddress}
      reactions={reactionsByMessage[message.id] ?? []}
      pendingReaction={pendingReactions[message.id] ?? null}
      replyCount={inThread ? 0 : repliesTo(message.id).length}
      onReact={(emoji) => void react(message.id, emoji)}
      onOpenThread={inThread ? undefined : () => setThreadId(message.id)}
      onRetry={() => retrySendMessage(message)}
      onHeightChange={onHeightChange}
      canOfferResend={isFeedLive}
    />
  );

  const joinButton = (label: string) => (
    <button type="button" className="chat-login-prompt" onClick={askForName}>
      {label}
    </button>
  );

  const threadParent = threadId ? messages.find((message) => message.id === threadId) : undefined;

  const body = () => {
    if (status === CHAT_UNREACHABLE) {
      return (
        <div className="chat-state chat-state-error" role="status">
          <p className="chat-state-title">The chat cannot be reached right now.</p>
          <p className="chat-state-detail">
            The video is not affected. Messages show here again once the chat answers.
          </p>
          <Button variant={ButtonVariant.SECONDARY} onClick={restart}>
            Try again
          </Button>
        </div>
      );
    }

    if (status === CHAT_LOADING) {
      return (
        <p className="chat-loading" role="status">
          Loading the chat…
        </p>
      );
    }

    if (threadParent) {
      return (
        <ThreadView
          original={renderMessage(threadParent, undefined, true)}
          replies={repliesTo(threadParent.id)}
          renderReply={(reply, onHeightChange) => renderMessage(reply, onHeightChange, true)}
          onBack={() => setThreadId(null)}
          composer={
            session ? (
              <MessageSender
                label="Reply"
                placeholder="Reply in the thread"
                onSend={(text) => sendReply(threadParent.id, text)}
                checkDraft={(text) => checkReply(threadParent.id, text)}
              />
            ) : (
              joinButton('Join the chat to reply')
            )
          }
        />
      );
    }

    return (
      <>
        <FeedNotice status={feedStatus} />
        {hasOlder && (
          <button
            type="button"
            className="chat-load-more"
            disabled={isLoadingOlder}
            onClick={() => void fetchOlderMessages()}
          >
            {isLoadingOlder ? 'Loading older messages…' : 'Load older messages'}
          </button>
        )}
        {messages.length > 0 ? (
          <ScrollableMessageList
            items={messages}
            label="Messages"
            renderItem={(message, onHeightChange) => renderMessage(message, onHeightChange)}
          />
        ) : (
          <p className="chat-empty">No messages yet.</p>
        )}
        {session ? (
          <MessageSender label="Message" placeholder="Type a message" onSend={sendMessage} checkDraft={checkMessage} />
        ) : (
          joinButton('Join the chat to send messages')
        )}
      </>
    );
  };

  return (
    <section className={isFolded ? 'chat-container folded' : 'chat-container'} aria-labelledby={`${bodyId}-title`}>
      <header className="chat-header">
        <h2 id={`${bodyId}-title`} className="chat-title">
          Chat
        </h2>
        <button
          type="button"
          className="chat-fold-button"
          aria-expanded={!isFolded}
          aria-controls={bodyId}
          onClick={() => setIsFolded((folded) => !folded)}
        >
          {isFolded ? 'Show chat' : 'Hide chat'}
        </button>
      </header>
      <div id={bodyId} className="chat-body" hidden={isFolded}>
        {body()}
      </div>
    </section>
  );
}

export default Chat;
