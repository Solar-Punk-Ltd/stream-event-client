import { useEffect, useRef, useState } from 'react';

import { EmojiPickerPopover } from '../../EmojiPicker/EmojiPickerPopover';

import './MessageActions.scss';

interface MessageActionsProps {
  /** Shown once the message is tapped on a touch screen, folded away on the next tap. */
  visible: boolean;
  ownMessage: boolean;
  onReact: (emoji: string) => void;
  onOpenThread?: () => void;
  disabled?: boolean;
}

/**
 * The Swarm site's two actions on a message, a reaction and a reply, sliding in on the side of the row
 * the bubble leaves empty. The reaction opens the emoji picker beside its button.
 */
export function MessageActions({ visible, ownMessage, onReact, onOpenThread, disabled = false }: MessageActionsProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [wasOpenedByKeyboard, setWasOpenedByKeyboard] = useState(false);
  const reactButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!visible) {
      setIsPickerOpen(false);
    }
  }, [visible]);

  const classes = ['message-actions', visible && 'visible', ownMessage && 'own-message'].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      <button
        ref={reactButtonRef}
        type="button"
        className="message-action"
        aria-label="Add reaction"
        aria-expanded={isPickerOpen}
        title={disabled ? 'Sending reaction…' : 'Add reaction'}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          // A click the keyboard made counts no presses, and only then does the picker take focus, so a
          // phone does not raise its keyboard over the picker for a search nobody asked for.
          setWasOpenedByKeyboard(event.detail === 0);
          setIsPickerOpen((open) => !open);
        }}
      >
        <span aria-hidden="true">{disabled ? '⏳' : '😊'}</span>
      </button>
      {onOpenThread && (
        <button
          type="button"
          className="message-action"
          aria-label="Reply in a thread"
          title="Reply in thread"
          onClick={(event) => {
            event.stopPropagation();
            onOpenThread();
          }}
        >
          <span aria-hidden="true">💬</span>
        </button>
      )}

      {isPickerOpen && (
        <EmojiPickerPopover
          anchorRef={reactButtonRef}
          ownMessage={ownMessage}
          takesFocus={wasOpenedByKeyboard}
          onPick={onReact}
          onClose={() => setIsPickerOpen(false)}
        />
      )}
    </div>
  );
}
