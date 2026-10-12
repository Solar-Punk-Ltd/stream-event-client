import { Suspense, useState, type MouseEvent } from 'react';

import { EmojiPickerPanel } from '../../EmojiPicker/lazyEmojiPicker';
import { pickerSize, type PickerSize } from '../../EmojiPicker/pickerPlacement';

import './ReactionToolbar.scss';

/** The library's own name for the last button of its bar of common emoji, which shows every emoji. */
const SHOW_ALL_EMOJIS = 'button[aria-label="Show all Emojis"]';

interface ReactionToolbarProps {
  onEmojiSelect: (emoji: string) => void;
}

/**
 * The bar of common emoji above the message field, the picker library's own as the Swarm site has it.
 * Its last button opens every emoji in place above the field, and a close button folds it back.
 */
export function ReactionToolbar({ onEmojiSelect }: ReactionToolbarProps) {
  const [expandedSize, setExpandedSize] = useState<PickerSize | null>(null);
  // A new key draws the picker afresh, which is the only way back to its bar once it is expanded.
  const [pickerKey, setPickerKey] = useState(0);

  const noticeExpand = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest(SHOW_ALL_EMOJIS)) {
      setExpandedSize(pickerSize({ width: window.innerWidth, height: window.innerHeight }));
    }
  };

  const collapse = () => {
    setExpandedSize(null);
    setPickerKey((key) => key + 1);
  };

  return (
    <div className={expandedSize ? 'reaction-toolbar expanded' : 'reaction-toolbar'} onClickCapture={noticeExpand}>
      {expandedSize && (
        <button type="button" className="close-picker-button" aria-label="Close the emoji picker" onClick={collapse}>
          <span aria-hidden="true">✕</span>
        </button>
      )}
      <Suspense fallback={<div className="reaction-toolbar-placeholder" />}>
        <EmojiPickerPanel key={pickerKey} startsAsReactionBar size={expandedSize ?? undefined} onPick={onEmojiSelect} />
      </Suspense>
    </div>
  );
}
