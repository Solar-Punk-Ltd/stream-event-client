import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { MessageVia } from '@solarpunkltd/swarm-chat-js';

import { useEnsName } from '../../ens/EnsNames';
import type { ReactionSummary } from '../../reactions';
import type { VisibleMessage } from '../../useSwarmChat';

import { MessageActions } from './MessageActions/MessageActions';
import { MessageDetails } from './MessageDetails/MessageDetails';
import { MessageReactionsWrapper } from './MessageReactionsWrapper/MessageReactionsWrapper';
import { MessageThreadWrapper } from './MessageThreadWrapper/MessageThreadWrapper';
import { senderBadge } from './senderBadge';
import { SenderLine } from './SenderLine/SenderLine';

import './ChatMessage.scss';

interface ChatMessageProps {
  message: VisibleMessage;
  ownMessage: boolean;
  reactions: ReactionSummary[];
  /** The emoji of this message's reaction still being sent, if any. */
  pendingReaction?: string | null;
  replyCount?: number;
  onReact: (emoji: string) => void;
  /** Left out where the message is itself the thread being read. */
  onOpenThread?: () => void;
  onRetry: () => void;
  onHeightChange?: () => void;
  /** False while the chat is reconnecting or stalled, when a resend by hand cannot help. */
  canOfferResend?: boolean;
}

/**
 * How long an own message may sit written but unread from the chat feed before the viewer is offered a resend.
 * The library resends it on its own meanwhile, and a resend by hand sends the same bytes again.
 */
const UNCONFIRMED_AFTER_MS = 20_000;

/** True once an own message has waited too long to be read back from the chat feed. */
function useIsUnconfirmed(waiting: boolean, onHeightChange?: () => void): boolean {
  const [isUnconfirmed, setIsUnconfirmed] = useState(false);

  useEffect(() => {
    if (!waiting) {
      setIsUnconfirmed(false);
      return;
    }
    const timer = setTimeout(() => {
      setIsUnconfirmed(true);
      onHeightChange?.();
    }, UNCONFIRMED_AFTER_MS);
    return () => clearTimeout(timer);
  }, [waiting, onHeightChange]);

  return isUnconfirmed;
}

/**
 * Whether a message's details card is open, and the button that opened it, which gets focus back when the card
 * closes by Escape or by its own button.
 */
function useDetailsCard(onHeightChange?: () => void) {
  const [isShown, setIsShown] = useState(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setIsShown(false);
    openerRef.current?.focus();
    onHeightChange?.();
  }, [onHeightChange]);

  const toggle = useCallback(
    (opener: HTMLButtonElement) => {
      openerRef.current = opener;
      setIsShown((shown) => !shown);
      onHeightChange?.();
    },
    [onHeightChange],
  );

  useEffect(() => {
    if (!isShown) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isShown, close]);

  return { isShown, toggle, close };
}

/** A touch screen, which has no hover, so a tap is the only way to show a message's actions there. */
function hasNoHover(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;
}

/**
 * One message as the design draws it: the sender line above a bubble, the viewer's own on the right. The pointer over
 * the message shows what can be done with it, and so does keyboard focus inside it. A mouse click never keeps them,
 * since a click on the sender's badge opens the details and nothing else. On a touch screen a tap shows them and the
 * next tap folds them away.
 */
export function ChatMessage({
  message,
  ownMessage,
  reactions,
  pendingReaction = null,
  replyCount = 0,
  onReact,
  onOpenThread,
  onRetry,
  onHeightChange,
  canOfferResend = true,
}: ChatMessageProps) {
  const { error = false, received = false, uploaded = false, requested = false } = message;
  const isSending = !received && !error && (requested || uploaded);
  const isUnconfirmed =
    useIsUnconfirmed(ownMessage && uploaded && !received && !error, onHeightChange) && canOfferResend;
  const canAct = received && !error;
  const [areActionsShown, setAreActionsShown] = useState(false);
  const details = useDetailsCard(onHeightChange);
  const detailsId = useId();
  const badge = senderBadge(message.identity);
  const ensName = useEnsName(message.identity?.wallet);
  const ownStamp = message.signedMessage.via === MessageVia.OWN_STAMP;

  const classes = [
    'chat-message',
    ownMessage && 'own-message',
    canAct && 'can-act',
    error && 'chat-message-error',
    isSending && 'not-received',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className={classes} onClick={() => canAct && hasNoHover() && setAreActionsShown((shown) => !shown)}>
      <div className="chat-message-text">
        <SenderLine
          name={ensName ?? message.username}
          isEnsName={ensName !== undefined}
          badge={badge}
          ownStamp={ownStamp}
          timestamp={message.timestamp}
          detailsId={detailsId}
          areDetailsShown={details.isShown}
          onToggleDetails={details.toggle}
        />
        <span className="message">{message.message}</span>

        {details.isShown && (
          <MessageDetails
            id={detailsId}
            name={message.username}
            ensName={ensName}
            address={message.address}
            signature={message.signedMessage.sig}
            badge={badge}
            identity={message.identity}
            ownStamp={ownStamp}
            onClose={details.close}
          />
        )}

        {error && (
          <p className="chat-message-status error">
            {message.sendProblem ? `Not sent. ${message.sendProblem}` : 'Not sent.'}
            {message.canRetry !== false && (
              <>
                {' '}
                <button type="button" className="chat-message-retry" onClick={onRetry}>
                  Retry
                </button>
              </>
            )}
          </p>
        )}
        {isSending && !isUnconfirmed && <p className="chat-message-status">Sending…</p>}
        {isSending && isUnconfirmed && (
          <p className="chat-message-status">
            Not confirmed yet.{' '}
            <button type="button" className="chat-message-retry" onClick={onRetry}>
              Resend
            </button>
          </p>
        )}

        <MessageReactionsWrapper reactions={reactions} pendingReaction={pendingReaction} onReact={onReact} />

        {onOpenThread && <MessageThreadWrapper replyCount={replyCount} onOpenThread={onOpenThread} />}
      </div>

      {canAct && (
        <MessageActions
          visible={areActionsShown}
          ownMessage={ownMessage}
          onReact={onReact}
          onOpenThread={onOpenThread}
          disabled={pendingReaction !== null}
        />
      )}
    </li>
  );
}
