import { Suspense, useEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { Spinner } from '@/shared/components/Spinner/Spinner';

import { EmojiPickerPanel } from './lazyEmojiPicker';
import { pickerPlace, pickerSize } from './pickerPlacement';

import './EmojiPickerPopover.scss';

const KEY_ESCAPE = 'Escape';

interface EmojiPickerPopoverProps {
  /** The button that opened the picker, which it opens beside. A press on it is left to the button. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Whose message the picker opened from, which decides the side it reaches towards. */
  ownMessage: boolean;
  onPick: (emoji: string) => void;
  onClose: () => void;
}

/**
 * The emoji picker opened beside a message, as the Swarm site opens it: no dialog, nothing dimmed. It is
 * drawn into the body so the chat's scrolling list cannot clip it, and a press anywhere else or Escape
 * closes it.
 */
export function EmojiPickerPopover({ anchorRef, ownMessage, onPick, onClose }: EmojiPickerPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const size = pickerSize(viewport);
  const anchor = anchorRef.current?.getBoundingClientRect();
  const place = anchor ? pickerPlace(anchor, size, viewport, ownMessage) : { top: 0, left: 0 };

  useEffect(() => {
    const closeOnPressOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!popoverRef.current?.contains(target) && !anchorRef.current?.contains(target)) {
        onCloseRef.current();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === KEY_ESCAPE) {
        onCloseRef.current();
        anchorRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', closeOnPressOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnPressOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [anchorRef]);

  return createPortal(
    <div
      ref={popoverRef}
      className="emoji-picker-popover"
      style={{ top: place.top, left: place.left, width: size.width }}
      // A click inside still reaches the message through React's tree, where it would fold the actions away.
      onClick={(event) => event.stopPropagation()}
    >
      <Suspense
        fallback={
          <p className="emoji-picker-loading">
            <Spinner /> Loading the emoji…
          </p>
        }
      >
        <EmojiPickerPanel
          size={size}
          onPick={(emoji) => {
            onPick(emoji);
            onClose();
          }}
        />
      </Suspense>
    </div>,
    document.body,
  );
}
